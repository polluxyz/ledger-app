/** 分帳的原子寫入與擁有者隔離；份額只呼叫 shared 的計算函式。 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { computeSplitShares, ErrorCode, MAX_AMOUNT_CENTS } from '@ledger/shared';
import type {
  CreateSplitRequest,
  Split as SplitResponse,
  UpdateSplitResponse,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from '../debts/debt-ledger-access';
import { deltaFor, lockCounterparty, notFound } from '../debts/debt-entry-rules';
import {
  proposeAmend,
  proposeCreate,
  proposeDelete,
  syncStatuses,
} from '../debts/debt-proposal-rules';
import { recordDebtTransaction } from '../debts/debt-recording';
import { composeSplitEntries, planSplitEntries, type SplitEntryShape } from './split-entry-plan';

type Input = CreateSplitRequest;
type EntryKind = SplitEntryShape['kind'];
type SplitRow = Awaited<ReturnType<SplitsService['loadOwned']>>;

@Injectable()
export class SplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /** 先檢查內容與所有權，後寫入整份分帳；任何失敗由資料庫交易回滾。 */
  async create(userId: string, input: Input): Promise<SplitResponse> {
    const shares = this.shares(input, false);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.validateReferences(tx, userId, input);
      if (input.fromTransactionId) {
        const original = await tx.transaction.findFirst({
          where: {
            id: input.fromTransactionId,
            creatorId: userId,
            deletedAt: null,
            splitId: null,
            type: input.type,
          },
          include: { debtEntry: true },
        });
        if (!original || original.debtEntry !== null)
          throw conflict(
            ErrorCode.TRANSACTION_NOT_CONVERTIBLE,
            'This transaction cannot become a split.',
          );
        // 轉分帳會軟刪除原交易，等於對原交易所在的帳本做一次刪除，所以那本帳本也要可寫入。
        // 只看「是我記的」不夠：被移出共享帳本的人，不能藉這條路刪掉他以前記的交易。
        await assertLedgerWritable(tx, userId, original.ledgerId);
        await tx.transaction.update({
          where: { id: original.id },
          data: { deletedAt: new Date() },
        });
      }
      const split = await tx.split.create({
        data: {
          ownerId: userId,
          ledgerId: input.ledgerId,
          type: input.type,
          categoryId: input.categoryId,
          total: input.total,
          date: new Date(input.date),
          title: input.title ?? null,
          note: input.note ?? null,
          payerCounterpartyId: input.payer?.counterpartyId ?? null,
          accountId: input.accountId ?? null,
          method: input.method,
          precision: input.precision ?? 'CENT',
        },
      });
      await tx.splitParticipant.createMany({
        data: input.participants.map((person, index) => ({
          splitId: split.id,
          counterpartyId: person.counterpartyId,
          share: shares[index]!,
          ratio: input.method === 'RATIO' ? person.ratio! : null,
          sortOrder: index,
        })),
      });
      await this.writeComposition(tx, userId, split.id, input, shares, [], []);
      return split.id;
    });
    return this.get(userId, id);
  }

  async get(userId: string, id: string): Promise<SplitResponse> {
    const row = await this.loadOwned(this.prisma, userId, id);
    const activeEntries = row.entries.filter((entry) => entry.deletedAt === null);
    const sync = await syncStatuses(this.prisma, activeEntries);
    const payerEntry =
      row.payerCounterpartyId === null
        ? null
        : (activeEntries.find((entry) => entry.counterpartyId === row.payerCounterpartyId) ?? null);
    return {
      id: row.id,
      type: row.type,
      ledgerId: row.ledgerId,
      category: { id: row.category.id, name: row.category.name },
      total: row.total,
      date: row.date.toISOString(),
      title: row.title,
      note: row.note,
      payer: row.payer ? { counterpartyId: row.payer.id, name: displayName(row.payer) } : null,
      payerEntryId: payerEntry?.id ?? null,
      account: row.account ? { id: row.account.id, name: row.account.name } : null,
      method: row.method,
      precision: row.precision,
      participants: row.participants.map((person) => {
        const entry = activeEntries.find(
          (candidate) => candidate.counterpartyId === person.counterpartyId,
        );
        return {
          counterpartyId: person.counterpartyId,
          name: person.counterparty ? displayName(person.counterparty) : null,
          share: person.share,
          ratio: person.ratio,
          entryId: entry?.id ?? null,
          sync: entry ? (sync.get(entry.id) ?? 'NONE') : null,
        };
      }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** PATCH 是整份替換；逐人比對保留同種類的往來紀錄及其配對。 */
  async update(
    userId: string,
    id: string,
    input: Omit<Input, 'fromTransactionId'>,
  ): Promise<UpdateSplitResponse> {
    // 交易外先讀一次，只為了讓別人的分帳先回 404，不洩漏「這筆輸入格式錯不錯」。
    // 比對一律用交易內、鎖住分帳之後讀到的 current。
    await this.loadOwned(this.prisma, userId, id);
    const shares = this.shares(input, true);
    const dissolve =
      input.payer === null &&
      input.participants.length === 1 &&
      input.participants[0]?.counterpartyId === null;
    const remainingId = await this.prisma.$transaction(async (tx) => {
      // 先鎖住分帳本身：同一筆分帳的兩個修改同時到時，後到的要看到前一個寫完的結果，
      // 否則兩邊都拿舊的往來組合比對，會重複建立或漏刪往來紀錄。
      await lockSplit(tx, id);
      const current = await this.loadOwned(tx, userId, id);
      await assertLedgerWritable(tx, userId, current.ledgerId);
      await this.validateReferences(tx, userId, input);
      const oldEntries = current.entries.filter((entry) => entry.deletedAt === null);
      const oldTransactions = current.transactions.filter(
        (transaction) => transaction.deletedAt === null,
      );
      const desired = dissolve ? [] : composeSplitEntries(input, shares);
      // 對象鎖依 id 排序，避免並發分帳以不同順序等待造成死結。
      const ids = [
        ...new Set([
          ...oldEntries.map((entry) => entry.counterpartyId),
          ...desired.map((entry) => entry.counterpartyId),
        ]),
      ].sort();
      for (const counterpartyId of ids) await lockCounterparty(tx, counterpartyId);
      if (dissolve) {
        const now = new Date();
        await this.deleteEntries(tx, userId, oldEntries, now, current.title);
        const plain = oldTransactions.find((transaction) => transaction.debtEntry === null);
        let transactionId: string;
        if (plain) {
          await tx.transaction.update({
            where: { id: plain.id },
            data: {
              splitId: null,
              ledgerId: input.ledgerId,
              type: input.type,
              amount: input.total,
              date: new Date(input.date),
              title: input.title ?? null,
              // 解散後它是一般交易：分帳的備註原本只存在分帳上，這時要搬到交易，否則就消失了。
              note: input.note ?? null,
              categoryId: input.categoryId,
              accountId: input.accountId ?? null,
            },
          });
          transactionId = plain.id;
        } else {
          transactionId = await this.transactions.createSplitShareTransaction(tx, {
            ledgerId: input.ledgerId,
            creatorId: userId,
            type: input.type,
            amount: input.total,
            date: new Date(input.date),
            categoryId: input.categoryId,
            accountId: input.accountId,
            title: input.title,
            splitId: id,
          });
          await tx.transaction.update({
            where: { id: transactionId },
            data: { splitId: null, note: input.note ?? null },
          });
        }
        await tx.transaction.updateMany({
          where: { splitId: id, id: { not: transactionId }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.split.update({ where: { id }, data: { deletedAt: now } });
        return transactionId;
      }
      await tx.split.update({
        where: { id },
        data: {
          ledgerId: input.ledgerId,
          type: input.type,
          categoryId: input.categoryId,
          total: input.total,
          date: new Date(input.date),
          title: input.title ?? null,
          note: input.note ?? null,
          payerCounterpartyId: input.payer?.counterpartyId ?? null,
          accountId: input.accountId ?? null,
          method: input.method,
          precision: input.precision ?? 'CENT',
        },
      });
      await tx.splitParticipant.deleteMany({ where: { splitId: id } });
      await tx.splitParticipant.createMany({
        data: input.participants.map((person, index) => ({
          splitId: id,
          counterpartyId: person.counterpartyId,
          share: shares[index]!,
          ratio: input.method === 'RATIO' ? person.ratio! : null,
          sortOrder: index,
        })),
      });
      await this.writeComposition(tx, userId, id, input, shares, oldEntries, oldTransactions);
      return null;
    });
    if (remainingId)
      return {
        split: null,
        transaction: await this.transactions.getById(input.ledgerId, remainingId, userId),
      };
    return { split: await this.get(userId, id), transaction: null };
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockSplit(tx, id);
      const row = await this.loadOwned(tx, userId, id);
      await assertLedgerWritable(tx, userId, row.ledgerId);
      const entries = row.entries.filter((entry) => entry.deletedAt === null);
      for (const counterpartyId of [
        ...new Set(entries.map((entry) => entry.counterpartyId)),
      ].sort())
        await lockCounterparty(tx, counterpartyId);
      const now = new Date();
      await this.deleteEntries(tx, userId, entries, now, row.title);
      await tx.transaction.updateMany({
        where: { splitId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.split.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  private shares(input: Omit<Input, 'fromTransactionId'>, allowDissolve: boolean): number[] {
    if (input.total <= 0 || input.total > MAX_AMOUNT_CENTS || !Number.isSafeInteger(input.total))
      throw bad('Invalid total.');
    if (input.method === 'AMOUNT' && input.precision !== undefined)
      throw bad('AMOUNT cannot specify precision.');
    for (const person of input.participants) {
      if (
        input.method === 'AMOUNT'
          ? person.amount === undefined || person.ratio !== undefined
          : input.method === 'RATIO'
            ? person.ratio === undefined || person.amount !== undefined
            : person.amount !== undefined || person.ratio !== undefined
      )
        throw bad('Participant values do not match the split method.');
    }
    const result = computeSplitShares({
      total: input.total,
      method: input.method,
      precision: input.precision,
      payerCounterpartyId: input.payer?.counterpartyId ?? null,
      participants: input.participants,
    });
    if (!result.ok)
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode[result.error], result.error);
    const hasMe = input.participants.some((person) => person.counterpartyId === null);
    if (input.payer && !hasMe)
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SPLIT_WITHOUT_ME,
        'The owner must participate when someone else pays.',
      );
    if (
      !allowDissolve &&
      !input.payer &&
      input.participants.every((person) => person.counterpartyId === null)
    )
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SPLIT_NOT_NEEDED,
        'Use a regular transaction for a single owner share.',
      );
    return result.shares;
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    userId: string,
    input: Omit<Input, 'fromTransactionId'>,
  ): Promise<void> {
    await assertLedgerWritable(tx, userId, input.ledgerId);
    const ledger = await tx.ledger.findUniqueOrThrow({
      where: { id: input.ledgerId },
      select: { tracksBalance: true },
    });
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, ledgerId: input.ledgerId },
    });
    if (!category) throw notFound('Category');
    if (category.type !== input.type)
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CATEGORY_TYPE_MISMATCH,
        'Category type does not match.',
      );
    const ids = [
      ...new Set([
        ...input.participants
          .map((person) => person.counterpartyId)
          .filter((id): id is string => id !== null),
        ...(input.payer ? [input.payer.counterpartyId] : []),
      ]),
    ];
    if (ids.length) {
      const count = await tx.counterparty.count({ where: { id: { in: ids }, ownerId: userId } });
      if (count !== ids.length) throw notFound('Counterparty');
    }
    if (input.payer !== null || !ledger.tracksBalance) {
      if (input.accountId !== undefined)
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_NOT_ALLOWED,
          'An account is not allowed here.',
        );
    } else if (!input.accountId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ACCOUNT_REQUIRED,
        'An account is required.',
      );
    }
    if (input.accountId) {
      const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
      if (!account) throw notFound('Account');
    }
  }

  /** 舊、新往來組合共用同一個差異計畫；相關交易與提議均在此交易內同步。 */
  private async writeComposition(
    tx: Prisma.TransactionClient,
    userId: string,
    splitId: string,
    input: Omit<Input, 'fromTransactionId'>,
    shares: number[],
    oldEntries: SplitRow['entries'],
    oldTransactions: SplitRow['transactions'],
  ): Promise<void> {
    const date = new Date(input.date);
    const desired = composeSplitEntries(input, shares);
    const old = oldEntries.map((entry) => ({
      id: entry.id,
      counterpartyId: entry.counterpartyId,
      kind: entry.kind as EntryKind,
      amount: Math.abs(entry.delta),
      date: entry.date,
    }));
    const plan = planSplitEntries(old, desired, date);
    const oldById = new Map(oldEntries.map((entry) => [entry.id, entry]));
    const ids = [
      ...new Set([
        ...oldEntries.map((entry) => entry.counterpartyId),
        ...desired.map((entry) => entry.counterpartyId),
      ]),
    ].sort();
    for (const counterpartyId of ids) await lockCounterparty(tx, counterpartyId);
    const now = new Date();
    await this.deleteEntries(
      tx,
      userId,
      plan.remove.map((row) => oldById.get(row.id)!),
      now,
      input.title ?? null,
    );
    for (const change of plan.amend) {
      const current = oldById.get(change.old.id)!;
      const updated = await tx.debtEntry.update({
        where: { id: current.id },
        data: { delta: deltaFor(change.next.kind, change.next.amount), date },
      });
      if (current.transactionId)
        await tx.transaction.update({
          where: { id: current.transactionId },
          data: {
            amount: change.next.amount,
            date,
            title: input.title ?? null,
            ledgerId: input.ledgerId,
            accountId: input.payer ? null : (input.accountId ?? null),
            categoryId: input.payer ? input.categoryId : null,
          },
        });
      await proposeAmend(tx, {
        fromUserId: userId,
        entry: updated,
        now,
        title: input.title ?? null,
      });
    }
    for (const entry of desired) {
      const previous = oldEntries.find(
        (row) => row.counterpartyId === entry.counterpartyId && row.kind === entry.kind,
      );
      if (previous && !plan.amend.some((change) => change.old.id === previous.id)) {
        if (previous.transactionId)
          await tx.transaction.update({
            where: { id: previous.transactionId },
            data: {
              title: input.title ?? null,
              ledgerId: input.ledgerId,
              accountId: input.payer ? null : (input.accountId ?? null),
              categoryId: input.payer ? input.categoryId : null,
            },
          });
      }
    }
    for (const entry of plan.create)
      await this.createEntry(tx, userId, splitId, input, date, entry);
    const own = oldTransactions.find((transaction) => transaction.debtEntry === null);
    const myShare =
      shares[input.participants.findIndex((person) => person.counterpartyId === null)] ?? 0;
    if (!input.payer && myShare > 0) {
      if (own)
        await tx.transaction.update({
          where: { id: own.id },
          data: {
            amount: myShare,
            date,
            title: input.title ?? null,
            ledgerId: input.ledgerId,
            categoryId: input.categoryId,
            accountId: input.accountId ?? null,
            type: input.type,
          },
        });
      else
        await this.transactions.createSplitShareTransaction(tx, {
          ledgerId: input.ledgerId,
          creatorId: userId,
          type: input.type,
          amount: myShare,
          date,
          categoryId: input.categoryId,
          accountId: input.accountId,
          title: input.title,
          splitId,
        });
    } else if (own)
      await tx.transaction.update({ where: { id: own.id }, data: { deletedAt: now } });
  }

  private async createEntry(
    tx: Prisma.TransactionClient,
    userId: string,
    splitId: string,
    input: Omit<Input, 'fromTransactionId'>,
    date: Date,
    entry: SplitEntryShape,
  ): Promise<void> {
    let transactionId: string;
    if (entry.kind === 'PAID_FOR_ME' || entry.kind === 'RECEIVED_FOR_ME') {
      transactionId = await this.transactions.createPaidForMeExpense(tx, {
        ledgerId: input.ledgerId,
        creatorId: userId,
        type: input.type,
        amount: entry.amount,
        date,
        categoryId: input.categoryId,
        title: input.title,
        splitId,
      });
    } else {
      transactionId = (await recordDebtTransaction(tx, this.transactions, {
        userId,
        record: {
          ledgerId: input.ledgerId,
          ...(input.accountId ? { accountId: input.accountId } : {}),
        },
        kind: entry.kind,
        amount: entry.amount,
        date,
        title: input.title,
        splitId,
      }))!;
    }
    const created = await tx.debtEntry.create({
      data: {
        counterpartyId: entry.counterpartyId,
        kind: entry.kind,
        delta: deltaFor(entry.kind, entry.amount),
        date,
        note: null,
        transactionId,
        splitId,
      },
    });
    await proposeCreate(tx, {
      fromUserId: userId,
      entry: created,
      amount: entry.amount,
      settle: false,
      title: input.title,
    });
  }

  private async deleteEntries(
    tx: Prisma.TransactionClient,
    userId: string,
    entries: SplitRow['entries'],
    now: Date,
    title: string | null,
  ): Promise<void> {
    for (const entry of entries) {
      await tx.debtEntry.update({ where: { id: entry.id }, data: { deletedAt: now } });
      await this.transactions.softDeleteDebtTransactions(
        tx,
        entry.transactionId ? [entry.transactionId] : [],
        now,
      );
      await proposeDelete(tx, { fromUserId: userId, entry, now, title });
    }
  }

  private async loadOwned(client: Prisma.TransactionClient, userId: string, id: string) {
    const row = await client.split.findFirst({
      where: { id, ownerId: userId, deletedAt: null },
      include: {
        category: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
        payer: {
          select: {
            id: true,
            name: true,
            linkAsLow: { select: { userHigh: { select: { name: true } } } },
            linkAsHigh: { select: { userLow: { select: { name: true } } } },
          },
        },
        participants: {
          orderBy: { sortOrder: 'asc' },
          include: {
            counterparty: {
              select: {
                name: true,
                linkAsLow: { select: { userHigh: { select: { name: true } } } },
                linkAsHigh: { select: { userLow: { select: { name: true } } } },
              },
            },
          },
        },
        entries: true,
        transactions: { include: { debtEntry: true } },
      },
    });
    if (!row) throw notFound('Split');
    return row;
  }
}

/** 鎖住一筆分帳（同一筆分帳的修改、刪除互相排隊）。不存在時什麼都不鎖，交給 loadOwned 回 404。 */
async function lockSplit(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Split" WHERE id = ${id} FOR UPDATE`;
}

function bad(message: string): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
}
function conflict(code: keyof typeof ErrorCode, message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode[code], message);
}

function displayName(counterparty: {
  name: string | null;
  linkAsLow?: { userHigh: { name: string } } | null;
  linkAsHigh?: { userLow: { name: string } } | null;
}): string {
  return (
    counterparty.name ??
    counterparty.linkAsLow?.userHigh.name ??
    counterparty.linkAsHigh?.userLow.name ??
    ''
  );
}
