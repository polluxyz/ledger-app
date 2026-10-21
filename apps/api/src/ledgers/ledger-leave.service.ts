import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  myLedgerAmounts,
  type LeaveRequest,
  type LedgerLeaveBlocker,
  type LedgerLeavePreview,
} from '@ledger/shared';
import { AccountsService } from '../accounts/accounts.service';
import { AppException } from '../common/exceptions/app.exception';
import { linkInfoFor } from '../debts/counterparty-links';
import { DebtEntriesService } from '../debts/debt-entries.service';
import { Prisma } from '../generated/prisma/client';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { loadEffectivePointers } from '../ledger-people/ledger-pointers';
import { PrismaService } from '../prisma/prisma.service';
import { computeLedgerSummary } from '../settlements/ledger-summary';
import { SplitsService } from '../splits/splits.service';
import { LedgersService } from './ledgers.service';
import {
  groupLedgerDeleteItems,
  planLedgerDeleteMove,
  type LedgerDeleteMovePlan,
} from './ledger-delete-move-plan';
import {
  planLedgerLeave,
  groupPersonalLeaveItems,
  type LedgerLeavePlan,
} from './ledger-leave-plan';

const transactionInclude = {
  category: true,
  creator: { select: { name: true } },
  payerPerson: { include: { user: { select: { name: true } } } },
  ledgerSplit: { include: { shares: { include: { person: { select: { userId: true } } } } } },
  settlement: {
    include: {
      fromPerson: { include: { user: { select: { name: true } } } },
      toPerson: { include: { user: { select: { name: true } } } },
    },
  },
  debtEntry: { include: { counterparty: { select: { ownerId: true } }, settledBy: true } },
} satisfies Prisma.TransactionInclude;
type TransactionRow = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;
type Membership = Prisma.LedgerMemberGetPayload<{ include: { ledger: true } }>;

/**
 * 退出是使用者自己的刪除與合併，檢視者也能執行。所有來源／目標授權都在交易內重查，
 * 執行使用 Serializable，鎖帳本與自己的成員列直到合併與撤銷全部完成。
 */
@Injectable()
export class LedgerLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly people: LedgerPeopleService,
    private readonly debtEntries: DebtEntriesService,
    private readonly splits: SplitsService,
    private readonly ledgers: LedgersService,
  ) {}

  async preview(
    ledgerId: string,
    userId: string,
    request: LeaveRequest,
  ): Promise<LedgerLeavePreview> {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await this.loadMember(tx, ledgerId, userId);
        this.validateRequest(member, request);
        if (member.ledger.kind === 'PERSONAL' && member.role !== 'OWNER') throw forbidden();
        const blockedBy =
          member.ledger.kind === 'PERSONAL'
            ? member.ledger.archivedAt
              ? 'LEDGER_ARCHIVED'
              : null
            : await this.blocker(tx, member, request);
        const loaded =
          member.ledger.kind === 'PERSONAL'
            ? await this.loadDeleteMovePlan(tx, member, userId, request)
            : await this.loadPlan(tx, member, userId, request, false, blockedBy === null);
        const zeroed = loaded.accounts.map((a) => ({ ...a, initialBalance: 0 }));
        const [{ balances }, { balances: source }, { balances: retained }] = await Promise.all([
          this.accounts.calculateBalances(loaded.accounts, tx),
          this.accounts.calculateBalances(zeroed, tx, { ledgerId }),
          this.accounts.calculateBalances(zeroed, tx, {
            ledgerId,
            id: { in: loaded.plan.retainedTransactionIds },
          }),
        ]);
        return {
          items: loaded.plan.items,
          accounts: loaded.accounts
            .map((a) => ({
              accountId: a.id,
              name: a.name,
              balance: balances.get(a.id)!,
              balanceAfter: balances.get(a.id)! - source.get(a.id)! + retained.get(a.id)!,
            }))
            .filter((a) => a.balance !== a.balanceAfter),
          carryOvers: loaded.plan.carryOvers.map(
            ({ ledgerPersonId, displayName, amount, counterpartyId }) => ({
              ledgerPersonId,
              displayName,
              amount,
              counterpartyId,
            }),
          ),
          withdrawals: loaded.plan.withdrawals,
          leave: { allowed: blockedBy === null, blockedBy },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }

  async leave(ledgerId: string, userId: string, request: LeaveRequest): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        let member = await this.loadMember(tx, ledgerId, userId);
        this.validateRequest(member, request);
        if (member.ledger.kind === 'PERSONAL') {
          // 來源也參與排序：兩人把 P1、P2 互搬時，不會各自先持有來源而互等。
          const ledgerIds = [
            ...new Set([ledgerId, ...request.moves!.map((m) => m.targetLedgerId)]),
          ].sort();
          for (const id of ledgerIds) await this.lockMember(tx, id, userId);
          member = await this.loadMember(tx, ledgerId, userId);
          if (member.role !== 'OWNER') throw forbidden();
          if (member.ledger.archivedAt) throw conflict(ErrorCode.LEDGER_ARCHIVED);
          if (request.confirm !== member.ledger.name)
            throw bad('confirm must exactly match the ledger name.');
          const { plan } = await this.loadDeleteMovePlan(tx, member, userId, request);
          await this.applyDeleteMovePlan(tx, userId, plan);
          await this.ledgers.deleteLedgerRows(tx, ledgerId);
          return;
        }
        member = await this.loadMember(tx, ledgerId, userId, true);
        if (member.ledger.archivedAt) throw conflict(ErrorCode.LEDGER_ARCHIVED);
        if (request.deleteLedger) {
          if (member.role !== 'OWNER') throw forbidden();
          if (await this.hasOtherMembers(tx, ledgerId, userId))
            throw conflict(ErrorCode.LEDGER_HAS_OTHER_MEMBERS);
          if (request.confirm !== member.ledger.name)
            throw bad('confirm must exactly match the ledger name.');
          if (await this.hasOthersAccounts(tx, ledgerId, userId))
            throw conflict(ErrorCode.LEDGER_HAS_OTHERS_TRANSACTIONS);
        } else if (await this.lastOwner(tx, member))
          throw conflict(ErrorCode.LAST_OWNER_CANNOT_LEAVE);
        const { plan } = await this.loadPlan(tx, member, userId, request, true);
        const targetLedgerId = plan.hasSelectedItems ? (request.targetLedgerId ?? null) : null;
        const merge = await tx.ledgerMerge.create({
          data: {
            userId,
            sourceLedgerId: ledgerId,
            sourceLedgerName: member.ledger.name,
            targetLedgerId,
          },
        });
        await this.applyPlan(tx, userId, targetLedgerId, merge.id, plan);
        // 決策 190：刻意不含 deletedAt，連已軟刪除的交易與臨時帳戶都必須清掉。
        // 兩端分開更新，不能把同筆交易上屬於別人的另一端也清掉。
        await tx.transaction.updateMany({
          where: { ledgerId, account: { userId } },
          data: { accountId: null },
        });
        await tx.transaction.updateMany({
          where: { ledgerId, toAccount: { userId } },
          data: { toAccountId: null },
        });
        await tx.ledgerPersonPointer.deleteMany({ where: { userId, ledgerPerson: { ledgerId } } });
        if (request.deleteLedger) await this.ledgers.deleteLedgerRows(tx, ledgerId);
        else await tx.ledgerMember.delete({ where: { ledgerId_userId: { ledgerId, userId } } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
    );
  }

  private validateRequest(member: Membership, request: LeaveRequest) {
    // DTO 經 class-transformer 後會有值為 undefined 的選用屬性；null 仍是明確帶入。
    if (member.ledger.kind === 'PERSONAL') {
      if (
        request.deleteLedger !== true ||
        !Array.isArray(request.moves) ||
        request.targetLedgerId !== undefined ||
        request.excludedItemIds !== undefined
      )
        throw bad('Personal ledger deletion requires deleteLedger and moves only.');
    } else if (
      request.moves !== undefined ||
      request.targetLedgerId === undefined ||
      !Array.isArray(request.excludedItemIds)
    ) {
      throw bad('Shared ledger leave requires targetLedgerId and excludedItemIds, without moves.');
    }
  }

  private async loadDeleteMovePlan(
    tx: Prisma.TransactionClient,
    member: Membership,
    userId: string,
    request: LeaveRequest,
  ) {
    const ledgerId = member.ledgerId;
    const [rows, splitRows, accounts, counterparties, sums] = await Promise.all([
      tx.transaction.findMany({
        where: { ledgerId, deletedAt: null },
        include: transactionInclude,
        orderBy: { id: 'asc' },
      }),
      tx.split.findMany({
        where: { ledgerId, ownerId: userId, deletedAt: null },
        include: { category: true, participants: true, entries: { where: { deletedAt: null } } },
        orderBy: { id: 'asc' },
      }),
      tx.account.findMany({
        where: { userId },
        orderBy: [{ isTemporary: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.counterparty.findMany({ where: { ownerId: userId }, orderBy: { id: 'asc' } }),
      tx.debtEntry.groupBy({
        by: ['counterpartyId'],
        where: { deletedAt: null, counterparty: { ownerId: userId } },
        _sum: { delta: true },
      }),
    ]);
    const personal = groupPersonalLeaveItems(rows, splitRows, userId, normalizeTransaction);
    const items = groupLedgerDeleteItems(
      rows.filter((t) => !t.debtEntry && !t.splitId && !t.differenceOfId).map(normalizeTransaction),
      personal,
    );
    const effects = new Map<string, LedgerLeavePreview['items'][number]['accountEffects']>();
    const zeroed = accounts.map((a) => ({ ...a, initialBalance: 0 }));
    for (const item of items) {
      const { balances } = await this.accounts.calculateBalances(zeroed, tx, {
        ledgerId,
        id: { in: item.transactions.map((t) => t.id) },
      });
      effects.set(
        item.id,
        accounts
          .filter((a) => balances.get(a.id) !== 0)
          .map((a) => ({ accountId: a.id, name: a.name, delta: balances.get(a.id)! })),
      );
    }
    const links = await linkInfoFor(
      tx,
      counterparties.map((c) => c.id),
    );
    const targetCategories = new Map<string, Awaited<ReturnType<typeof tx.category.findMany>>>();
    const input = {
      sourceLedgerId: ledgerId,
      items,
      moves: request.moves!,
      targetCategories,
      effects,
      counterparties: counterparties.map((c) => ({
        id: c.id,
        displayName: c.name ?? links.get(c.id)?.userName ?? '',
        linked: links.has(c.id),
        balance: sums.find((s) => s.counterpartyId === c.id)?._sum.delta ?? 0,
      })),
    };
    const preliminary = planLedgerDeleteMove(input);
    if (preliminary.errors.length) throw bad(preliminary.errors[0]!);
    // 即使來源封存仍驗目標；執行呼叫端已按固定順序鎖定全部帳本與成員。
    for (const move of request.moves!) {
      const target = await this.loadMember(tx, move.targetLedgerId, userId);
      if (target.role === 'VIEWER') throw forbidden();
      if (target.ledger.archivedAt) throw conflict(ErrorCode.LEDGER_ARCHIVED);
      targetCategories.set(
        move.targetLedgerId,
        await tx.category.findMany({ where: { ledgerId: move.targetLedgerId } }),
      );
    }
    return { plan: { ...planLedgerDeleteMove(input), carryOvers: [] }, accounts };
  }

  private async applyDeleteMovePlan(
    tx: Prisma.TransactionClient,
    userId: string,
    plan: LedgerDeleteMovePlan,
  ) {
    for (const group of plan.groups) {
      const categoryIds = new Map<string, string>();
      for (const category of group.categories) {
        const created = await tx.category.upsert({
          where: {
            ledgerId_type_name: {
              ledgerId: group.targetLedgerId,
              type: category.type,
              name: category.name,
            },
          },
          create: {
            ledgerId: group.targetLedgerId,
            type: category.type,
            name: category.name,
            icon: category.icon,
          },
          update: {},
        });
        categoryIds.set(category.ref, created.id);
      }
      const resolve = (ref: string | null) => (ref ? (categoryIds.get(ref) ?? ref) : null);
      for (const split of group.splits)
        await tx.split.update({
          where: { id: split.id, ownerId: userId },
          data: { ledgerId: group.targetLedgerId, categoryId: resolve(split.categoryRef)! },
        });
      for (const transaction of group.transactions)
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { ledgerId: group.targetLedgerId, categoryId: resolve(transaction.categoryRef) },
        });
    }
    for (const item of plan.withdrawalsToApply) {
      if (item.kind === 'PERSONAL_SPLIT')
        await this.splits.removeInTransaction(tx, userId, item.id, { purpose: 'ledger-leave' });
      else
        await this.debtEntries.removeInTransaction(tx, userId, item.entries[0]!.id, {
          purpose: 'ledger-leave',
        });
    }
  }

  private async loadMember(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    userId: string,
    lock = false,
  ): Promise<Membership> {
    if (lock) await this.lockMember(tx, ledgerId, userId);
    const member = await tx.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
      include: { ledger: true },
    });
    if (!member) throw notFound();
    return member;
  }

  private async lockMember(tx: Prisma.TransactionClient, ledgerId: string, userId: string) {
    // 鎖成員列也很重要：單鎖 Ledger 不能阻止成員被刪除或降級。
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT l."id" FROM "Ledger" l JOIN "LedgerMember" m ON m."ledgerId" = l."id"
      WHERE l."id" = ${ledgerId} AND m."userId" = ${userId} FOR UPDATE OF l, m
    `;
    if (!rows.length) throw notFound();
  }

  private async lastOwner(tx: Prisma.TransactionClient, member: Membership) {
    return (
      member.role === 'OWNER' &&
      (await tx.ledgerMember.count({ where: { ledgerId: member.ledgerId, role: 'OWNER' } })) <= 1
    );
  }
  private async hasOtherMembers(tx: Prisma.TransactionClient, ledgerId: string, userId: string) {
    return (await tx.ledgerMember.count({ where: { ledgerId, userId: { not: userId } } })) > 0;
  }
  private async hasOthersAccounts(tx: Prisma.TransactionClient, ledgerId: string, userId: string) {
    return (
      (await tx.transaction.count({
        where: {
          ledgerId,
          OR: [
            { account: { userId: { not: userId } } },
            { toAccount: { userId: { not: userId } } },
          ],
        },
      })) > 0
    );
  }
  private async blocker(
    tx: Prisma.TransactionClient,
    member: Membership,
    request: LeaveRequest,
  ): Promise<LedgerLeaveBlocker | null> {
    if (member.ledger.archivedAt) return 'LEDGER_ARCHIVED';
    if (request.deleteLedger) {
      if (member.role !== 'OWNER') throw forbidden();
      if (await this.hasOtherMembers(tx, member.ledgerId, member.userId))
        return 'HAS_OTHER_MEMBERS';
      if (await this.hasOthersAccounts(tx, member.ledgerId, member.userId))
        return 'HAS_OTHERS_TRANSACTIONS';
    } else if (await this.lastOwner(tx, member)) return 'LAST_OWNER';
    return null;
  }

  private async loadPlan(
    tx: Prisma.TransactionClient,
    member: Membership,
    userId: string,
    request: LeaveRequest,
    lockTarget: boolean,
    requireTarget = true,
  ) {
    const ledgerId = member.ledgerId;
    if (member.ledger.kind !== 'SHARED') throw bad('Only shared ledgers support leave and merge.');
    const [rows, splitRows, accounts, counterparties, summary, mergedBefore] = await Promise.all([
      tx.transaction.findMany({
        where: {
          ledgerId,
          deletedAt: null,
          OR: [
            { debtEntry: { counterparty: { ownerId: userId } } },
            { split: { ownerId: userId } },
            { differenceOf: { debtEntry: { counterparty: { ownerId: userId } } } },
            {
              debtEntry: null,
              splitId: null,
              differenceOfId: null,
              OR: [
                { payerPerson: { userId } },
                { payerPersonId: null, creatorId: userId },
                { ledgerSplit: { shares: { some: { person: { userId } } } } },
                { settlement: { fromPerson: { userId } } },
                { settlement: { toPerson: { userId } } },
                { account: { userId } },
                { toAccount: { userId } },
              ],
            },
          ],
        },
        include: transactionInclude,
        orderBy: { id: 'asc' },
      }),
      tx.split.findMany({
        where: { ledgerId, ownerId: userId, deletedAt: null },
        include: { category: true, participants: true, entries: { where: { deletedAt: null } } },
        orderBy: { id: 'asc' },
      }),
      tx.account.findMany({
        where: { userId },
        orderBy: [{ isTemporary: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.counterparty.findMany({ where: { ownerId: userId }, orderBy: { id: 'asc' } }),
      computeLedgerSummary(tx, ledgerId, this.people),
      // 決策 199：被加回後再退出，上次已合併過的原交易不再合併（含已在目標刪掉的合併列）。
      tx.transaction.findMany({
        where: { mergedFromId: { not: null }, merge: { userId, sourceLedgerId: ledgerId } },
        select: { mergedFromId: true },
      }),
    ]);
    const alreadyMerged = new Set(mergedBefore.map((row) => row.mergedFromId));
    const normalize = normalizeTransaction;
    const shared = rows
      .filter((t) => !t.debtEntry && !t.splitId && !t.differenceOfId && !alreadyMerged.has(t.id))
      .map(normalize);
    const personalItems = groupPersonalLeaveItems(rows, splitRows, userId, normalize);
    const effects = new Map<string, LedgerLeavePreview['items'][number]['accountEffects']>();
    const zeroed = accounts.map((a) => ({ ...a, initialBalance: 0 }));
    // 項目的帳戶效果也走既有公式。分帳與還款分支按一個可勾選項目一起計算。
    for (const item of [
      ...shared.map((t) => ({ id: t.id, ids: [t.id] })),
      ...personalItems.map((i) => ({ id: i.id, ids: i.transactions.map((t) => t.id) })),
    ]) {
      const { balances } = await this.accounts.calculateBalances(zeroed, tx, {
        ledgerId,
        id: { in: item.ids },
      });
      effects.set(
        item.id,
        accounts
          .filter((a) => balances.get(a.id) !== 0)
          .map((a) => ({ accountId: a.id, name: a.name, delta: balances.get(a.id)! })),
      );
    }
    const me = summary.people.find((p) => p.person.userId === userId);
    const amounts = me
      ? myLedgerAmounts(summary.suggestions, me.person.id)
      : new Map<string, number>();
    const otherPeople = summary.people.filter((p) => p.person.userId !== userId);
    const pointers = await loadEffectivePointers(
      tx,
      userId,
      otherPeople.map((p) => p.person.id),
    );
    const cpIds = counterparties.map((c) => c.id);
    const [sums, links] = await Promise.all([
      tx.debtEntry.groupBy({
        by: ['counterpartyId'],
        where: { deletedAt: null, counterparty: { ownerId: userId } },
        _sum: { delta: true },
      }),
      linkInfoFor(tx, cpIds),
    ]);
    const input = {
      userId,
      sourceLedgerName: member.ledger.name,
      transactions: shared,
      personalItems,
      ownAccountIds: accounts.map((a) => a.id),
      effects,
      excludedItemIds: request.excludedItemIds ?? [],
      ledgerAmounts: otherPeople.map(({ person }) => ({
        ledgerPersonId: person.id,
        displayName: person.name,
        amount: amounts.get(person.id) ?? 0,
        counterpartyId: pointers.get(person.id)?.counterpartyId ?? null,
      })),
      counterparties: counterparties.map((c) => ({
        id: c.id,
        name: c.name,
        displayName: c.name ?? links.get(c.id)?.userName ?? '',
        linked: links.has(c.id),
        balance: sums.find((s) => s.counterpartyId === c.id)?._sum.delta ?? 0,
      })),
    };
    // 先判斷有沒有勾選，再依 §4.2 檢查目標，最後才拒絕未知的 excluded id。
    const preliminary = planLedgerLeave({ ...input, targetCategories: [] });
    // 已被來源 blocker 擋下的預覽仍回 200；只略過「沒有目標」，非 null 目標與未知 id 照驗。
    const targetLedgerId = request.targetLedgerId ?? null;
    if (requireTarget && preliminary.hasSelectedItems && targetLedgerId === null)
      throw bad('A target ledger is required for selected items.');
    let targetCategories: NonNullable<(typeof rows)[number]['category']>[] = [];
    if (targetLedgerId !== null) {
      const target = await this.loadMember(tx, targetLedgerId, userId, lockTarget);
      if (target.role === 'VIEWER') throw forbidden();
      if (target.ledger.archivedAt) throw conflict(ErrorCode.LEDGER_ARCHIVED);
      if (targetLedgerId === ledgerId) throw bad('The target must differ from the source ledger.');
      targetCategories = await tx.category.findMany({
        where: { ledgerId: targetLedgerId },
      });
    }
    const plan = planLedgerLeave({ ...input, targetCategories });
    if (plan.unknownExcludedItemIds.length) throw bad('excludedItemIds contains an unknown item.');
    return { plan, accounts };
  }

  private async applyPlan(
    tx: Prisma.TransactionClient,
    userId: string,
    targetLedgerId: string | null,
    mergeId: string,
    plan: LedgerLeavePlan,
  ) {
    const categoryIds = new Map<string, string>();
    if (targetLedgerId) {
      for (const c of plan.categories) {
        const created = await tx.category.upsert({
          where: { ledgerId_type_name: { ledgerId: targetLedgerId, type: c.type, name: c.name } },
          create: { ledgerId: targetLedgerId, type: c.type, name: c.name, icon: c.icon },
          update: {},
        });
        categoryIds.set(c.ref, created.id);
      }
      const resolve = (ref: string | null) => (ref ? (categoryIds.get(ref) ?? ref) : null);
      for (const t of plan.transactions) {
        const { categoryRef, ...data } = t;
        await tx.transaction.create({
          data: {
            ...data,
            categoryId: resolve(categoryRef),
            ledgerId: targetLedgerId,
            creatorId: userId,
            mergeId,
          },
        });
      }
      for (const move of plan.moves) {
        if (move.item.kind === 'PERSONAL_SPLIT')
          await tx.split.update({
            where: { id: move.item.id, ownerId: userId },
            data: { ledgerId: targetLedgerId, categoryId: resolve(move.categoryRef)! },
          });
        for (const t of move.transactions)
          await tx.transaction.update({
            where: { id: t.id },
            data: { ledgerId: targetLedgerId, categoryId: resolve(t.categoryRef) },
          });
      }
    }
    for (const item of plan.withdrawalsToApply) {
      if (item.kind === 'PERSONAL_SPLIT')
        await this.splits.removeInTransaction(tx, userId, item.id, { purpose: 'ledger-leave' });
      else
        await this.debtEntries.removeInTransaction(tx, userId, item.entries[0]!.id, {
          purpose: 'ledger-leave',
        });
    }
    for (const carry of plan.carryOvers) {
      const counterpartyId =
        carry.counterpartyId ??
        (
          await tx.counterparty.create({
            data: { ownerId: userId, name: carry.newCounterpartyName },
          })
        ).id;
      await tx.debtEntry.create({
        data: {
          counterpartyId,
          kind: 'LEDGER_CARRY_OVER',
          delta: carry.amount,
          date: new Date(),
          transactionId: null,
          mergeId,
        },
      });
    }
  }
}

function notFound() {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
}
function forbidden() {
  return new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.FORBIDDEN,
    'You do not have permission to perform this action.',
  );
}
function bad(message: string) {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
}
function conflict(code: string) {
  return new AppException(HttpStatus.CONFLICT, code, code);
}

function normalizeTransaction(t: TransactionRow) {
  return {
    ...t,
    payer: t.payerPerson
      ? {
          userId: t.payerPerson.userId,
          name: t.payerPerson.name ?? t.payerPerson.user?.name ?? '',
        }
      : { userId: t.creatorId, name: t.creator.name },
    shares: t.ledgerSplit?.shares.map((s) => ({ userId: s.person.userId, share: s.share })) ?? null,
    settlement: t.settlement
      ? {
          from: {
            userId: t.settlement.fromPerson.userId,
            name: t.settlement.fromPerson.name ?? t.settlement.fromPerson.user?.name ?? '',
          },
          to: {
            userId: t.settlement.toPerson.userId,
            name: t.settlement.toPerson.name ?? t.settlement.toPerson.user?.name ?? '',
          },
        }
      : null,
  };
}
