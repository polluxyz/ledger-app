import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_CATEGORIES,
  ErrorCode,
  type AddMemberRequest,
  LedgerDetail,
  LedgerKind,
  LedgerMemberInfo,
  LedgerRole,
  LedgerSummary,
  LedgerRemovalPreview,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { LedgerAccess } from '../common/decorators/ledger-access-kind.decorator';
import { findLinkOfCounterparty, linkInfoFor, otherSide } from '../debts/counterparty-links';
import { AccountsService } from '../accounts/accounts.service';
import { DebtEntriesService } from '../debts/debt-entries.service';
import { SplitsService } from '../splits/splits.service';

/**
 * 帳本與成員的業務邏輯——授權與資料隔離的重心。個人模式與家庭模式共用同一套
 * 帳本模型，差別只在成員數與角色。
 *
 * 一般帳本與成員操作由 LedgerAccessGuard 在上游檢查資格；取消封存、刪除與預覽
 * 另在資料庫交易內重查擁有者。跨成員最關鍵的規則是「永遠至少保留一位 owner」——
 * 降級或移除最後一位 owner 都會被擋下，且在交易內重查以避開競態。
 */

/** 從資料庫選出的帳本資料列。 */
interface LedgerRow {
  id: string;
  name: string;
  currency: string;
  kind: LedgerKind;
  archivedAt: Date | null;
  createdAt: Date;
}

/**
 * 建立帳本所需的欄位。用具名物件而非一串位置參數，呼叫端讀起來認得出哪個是哪個。
 */
interface CreateLedgerInput {
  name: string;
  /** 省略時為 `PERSONAL`。建立後不可變更。 */
  kind?: LedgerKind;
}

/** 一筆成員關聯資料列，已 join 其 user，供成員相關回應使用。 */
interface MemberRow {
  userId: string;
  role: LedgerRole;
  user: { email: string; name: string };
}

@Injectable()
export class LedgersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerPeople: LedgerPeopleService,
    private readonly accounts: AccountsService,
    private readonly debtEntries: DebtEntriesService,
    private readonly splits: SplitsService,
  ) {}

  /**
   * 建立一個由指定使用者擁有的帳本，並灌入預設分類。它跑在「呼叫端傳入的」交易
   * client 上，因此能與其他寫入（例如註冊使用者）組成同一個原子交易。
   *
   * 這裡**不建立帳戶**——帳戶屬於使用者、跨帳本共用，種子在註冊時就已備妥。
   */
  async createLedgerForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateLedgerInput,
  ) {
    const { name, kind = 'PERSONAL' } = input;
    const ledger = await tx.ledger.create({ data: { name, kind } });

    await tx.ledgerMember.create({
      data: { ledgerId: ledger.id, userId, role: 'OWNER' },
    });

    if (kind === 'SHARED') {
      await this.ledgerPeople.ensureMemberPerson(tx, ledger.id, userId);
    }

    // `sortOrder` 取自陣列索引，讓畫面上的順序等於 `DEFAULT_CATEGORIES` 的定義順序
    // （「餐飲」排第一）。不能靠 `createdAt`——這裡是一次寫入，12 筆的時間戳相同，
    // 排序會變成沒有確定結果。
    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((category, index) => ({
        ledgerId: ledger.id,
        name: category.name,
        type: category.type,
        icon: category.icon,
        sortOrder: index,
      })),
    });

    return ledger;
  }

  /** 建立一個獨立帳本；建立者即成為 OWNER。 */
  async create(userId: string, input: CreateLedgerInput): Promise<LedgerSummary> {
    const ledger = await this.prisma.$transaction((tx) =>
      this.createLedgerForUser(tx, userId, input),
    );
    return this.toSummary(ledger, 'OWNER');
  }

  /**
   * 列出使用者所屬的帳本，每筆附上他在該帳本的角色。
   * 預設排除已封存的——封存的用意就是「從日常視野收起來」。
   */
  async listForUser(userId: string, includeArchived = false): Promise<LedgerSummary[]> {
    const memberships = await this.prisma.ledgerMember.findMany({
      where: {
        userId,
        ...(includeArchived ? {} : { ledger: { archivedAt: null } }),
      },
      include: { ledger: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => this.toSummary(membership.ledger, membership.role));
  }

  /** 回傳帳本及其完整成員清單。存取權限在上游（guard）把關。 */
  async getDetail(ledgerId: string, access: LedgerAccess = 'MEMBER'): Promise<LedgerDetail> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      include: { members: { include: { user: true } } },
    });
    if (!ledger) {
      throw this.notFound();
    }

    return {
      ...this.toLedger(ledger),
      // 已退出者不再有成員清單的讀取權；唯讀畫面只需要帳本基本資訊。
      members: access === 'LEFT' ? [] : ledger.members.map((member) => this.toMemberInfo(member)),
      left: access === 'LEFT',
    };
  }

  /**
   * 改帳本名稱，並回傳更新後的明細。
   *
   * `kind` 明確擋在這裡，它是建立後即定案的欄位：它決定這本帳本能不能加人，事後翻轉
   * 等於讓「誰看得到我的帳」在使用者沒有心理準備的情況下改變。
   */
  async rename(ledgerId: string, name: string, kind?: LedgerKind): Promise<LedgerDetail> {
    if (kind !== undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.LEDGER_KIND_IMMUTABLE,
        'kind is fixed when the ledger is created and cannot be changed.',
      );
    }
    await this.prisma.ledger.update({ where: { id: ledgerId }, data: { name } });
    return this.getDetail(ledgerId);
  }

  /**
   * 封存帳本：轉為唯讀，且預設不再出現在帳本清單中。
   *
   * 這是「結束一本帳本」的正常途徑，刪除則是例外（見 `remove`）。
   *
   * 走 HTTP 進來時，重複封存會先被 `LedgerAccessGuard` 擋成 409（封存的帳本
   * 一律不可寫入）；這裡仍保留「已封存就不覆寫時間」的判斷，讓 service 自身
   * 不依賴 guard 也是安全的——封存時間是稽核資訊，不該被第二次呼叫抹掉。
   */
  async archive(ledgerId: string): Promise<LedgerDetail> {
    const ledger = await this.prisma.ledger.findUnique({ where: { id: ledgerId } });
    if (!ledger) {
      throw this.notFound();
    }
    if (!ledger.archivedAt) {
      await this.prisma.ledger.update({
        where: { id: ledgerId },
        data: { archivedAt: new Date() },
      });
    }
    return this.getDetail(ledgerId);
  }

  /** 取消封存保留成員與交易；只有擁有者能恢復寫入。 */
  async unarchive(ledgerId: string, userId: string): Promise<LedgerDetail> {
    await this.prisma.$transaction(async (tx) => {
      const ledger = await this.loadOwnedLedger(tx, ledgerId, userId);
      if (!ledger.archivedAt) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.LEDGER_NOT_ARCHIVED,
          'This ledger is not archived.',
        );
      }
      await tx.ledger.update({ where: { id: ledgerId }, data: { archivedAt: null } });
    });
    return this.getDetail(ledgerId);
  }

  /**
   * 刪除前先確認名稱，再共用預覽的阻擋規則。私人帳本必須明確同意撤銷自己的借還與分帳；
   * 共享帳本有借還、或任何帳本會影響別人的交易／帳戶時只能封存。
   * 撤銷、解除往來的外鍵、刪分帳與帳本在同一個交易中完成，往來紀錄本身永遠保留。
   */
  async remove(
    ledgerId: string,
    actingUserId: string,
    confirm: string | undefined,
    withdrawDebts = false,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const ledger = await this.loadOwnedLedger(tx, ledgerId, actingUserId);
        if (confirm !== ledger.name) {
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_FAILED,
            'confirm must exactly match the ledger name.',
          );
        }
        const plan = await this.removalPlan(tx, ledger, actingUserId);
        if (plan.blockedBy) {
          const code =
            plan.blockedBy === 'HAS_OTHERS_TRANSACTIONS'
              ? ErrorCode.LEDGER_HAS_OTHERS_TRANSACTIONS
              : plan.blockedBy === 'LEDGER_ARCHIVED'
                ? ErrorCode.LEDGER_ARCHIVED
                : ErrorCode.LEDGER_HAS_DEBT_TRANSACTIONS;
          throw new AppException(
            HttpStatus.CONFLICT,
            code,
            'This ledger cannot be deleted; archive it instead.',
          );
        }
        if (plan.withdrawsDebts && !withdrawDebts) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.DEBT_WITHDRAWAL_REQUIRED,
            'Set withdrawDebts=true to withdraw this ledger’s debts.',
          );
        }
        for (const split of plan.activeSplits) {
          await this.splits.removeInTransaction(tx, actingUserId, split.id);
        }
        for (const entry of plan.entries) {
          if (entry.splitId === null && entry.settlesEntryId === null) {
            await this.debtEntries.removeInTransaction(tx, actingUserId, entry.id);
          }
        }
        await this.deleteLedgerRows(tx, ledgerId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** 3j §3：授權與撤銷由呼叫端完成，再依序解除外鍵、刪分帳、刪帳本。 */
  async deleteLedgerRows(tx: Prisma.TransactionClient, ledgerId: string): Promise<void> {
    await tx.debtEntry.updateMany({
      where: { OR: [{ transaction: { ledgerId } }, { split: { ledgerId } }] },
      data: { transactionId: null, splitId: null },
    });
    await tx.transaction.updateMany({
      where: { ledgerId, splitId: { not: null } },
      data: { splitId: null },
    });
    await tx.split.deleteMany({ where: { ledgerId } });
    // LedgerShare / LedgerSettlement / payerPerson 對 LedgerPerson 是 RESTRICT。
    // 先刪交易，讓共享分帳與結清 cascade 清除，再刪帳本，不能依賴同時 cascade 的順序。
    await tx.transaction.deleteMany({ where: { ledgerId } });
    await tx.ledger.delete({ where: { id: ledgerId } });
  }

  /** 只讀自己的帳戶與對象；不能刪時不回任何餘額。 */
  async removalPreview(ledgerId: string, userId: string): Promise<LedgerRemovalPreview> {
    return this.prisma.$transaction(
      async (tx) => {
        const ledger = await this.loadOwnedLedger(tx, ledgerId, userId);
        const plan = await this.removalPlan(tx, ledger, userId);
        if (plan.blockedBy) {
          return {
            accounts: [],
            counterparties: [],
            withdrawsDebts: false,
            delete: { allowed: false, blockedBy: plan.blockedBy },
          };
        }
        const rows = await tx.account.findMany({
          where: { userId },
          orderBy: [{ isTemporary: 'asc' }, { createdAt: 'asc' }],
        });
        const { balances } = await this.accounts.calculateBalances(rows, tx);
        const { balances: impacts } = await this.accounts.calculateBalances(
          rows.map((row) => ({ ...row, initialBalance: 0 })),
          tx,
          { ledgerId },
        );
        const accounts = rows
          .filter((row) => impacts.get(row.id) !== 0)
          .map((row) => ({
            accountId: row.id,
            name: row.name,
            balance: balances.get(row.id)!,
            balanceAfter: balances.get(row.id)! - impacts.get(row.id)!,
          }));
        const ids = [...new Set(plan.entries.map((entry) => entry.counterpartyId))];
        const counterparties = await tx.counterparty.findMany({
          where: { ownerId: userId, id: { in: ids } },
          orderBy: { id: 'asc' },
        });
        const sums = await tx.debtEntry.groupBy({
          by: ['counterpartyId'],
          where: {
            deletedAt: null,
            counterparty: { ownerId: userId },
            counterpartyId: { in: ids },
          },
          _sum: { delta: true },
        });
        const links = await linkInfoFor(tx, ids);
        return {
          accounts,
          // 只列刪除後餘額會變的對象；借了又還清的，前後都是兩清，不必列（開發者 2026-10-17）。
          counterparties: counterparties
            .map((row) => {
              const balance = sums.find((sum) => sum.counterpartyId === row.id)?._sum.delta ?? 0;
              const impact = plan.entries
                .filter((entry) => entry.counterpartyId === row.id)
                .reduce((sum, entry) => sum + entry.delta, 0);
              const link = links.get(row.id);
              return {
                counterpartyId: row.id,
                displayName: row.name ?? link?.userName ?? '',
                linked: link != null,
                balance,
                balanceAfter: balance - impact,
              };
            })
            .filter((row) => row.balance !== row.balanceAfter),
          withdrawsDebts: plan.withdrawsDebts,
          delete: { allowed: true, blockedBy: null },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async loadOwnedLedger(tx: Prisma.TransactionClient, ledgerId: string, userId: string) {
    const member = await tx.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!member) throw this.notFound();
    if (member.role !== 'OWNER')
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only an owner can perform this action.',
      );
    const ledger = await tx.ledger.findUnique({ where: { id: ledgerId } });
    if (!ledger) throw this.notFound();
    return ledger;
  }

  /** 預覽與實際刪除唯一的資格檢查；已撤銷的私人往來只需解除外鍵。 */
  private async removalPlan(tx: Prisma.TransactionClient, ledger: LedgerRow, userId: string) {
    type BlockedBy = LedgerRemovalPreview['delete']['blockedBy'];
    let blockedBy: BlockedBy = ledger.archivedAt ? 'LEDGER_ARCHIVED' : null;
    const ledgerId = ledger.id;
    // 3j 決策 187，將來退出規則定案為『退出就不算』時要放寬，見 spec §1『延後』。
    // 不過濾 deletedAt：已軟刪除的交易仍是他人的紀錄與帳戶引用。
    if (
      !blockedBy &&
      (await tx.transaction.count({
        where: {
          ledgerId,
          OR: [
            { creatorId: { not: userId } },
            { account: { userId: { not: userId } } },
            { toAccount: { userId: { not: userId } } },
          ],
        },
      })) > 0
    )
      blockedBy = 'HAS_OTHERS_TRANSACTIONS';
    const debtRows = blockedBy
      ? []
      : await tx.debtEntry.findMany({
          where: {
            OR: [
              { transaction: { ledgerId } },
              { split: { ledgerId } },
              { settlesEntry: { transaction: { ledgerId } } },
            ],
          },
          include: { counterparty: { select: { ownerId: true } } },
          orderBy: { id: 'asc' },
        });
    const splitRows = blockedBy
      ? []
      : await tx.split.findMany({ where: { ledgerId }, orderBy: { id: 'asc' } });
    const active = debtRows.filter((entry) => entry.deletedAt === null);
    const activeSplits = splitRows.filter((split) => split.deletedAt === null);
    if (
      !blockedBy &&
      ((ledger.kind === 'SHARED' && (debtRows.length > 0 || splitRows.length > 0)) ||
        active.some((entry) => entry.counterparty.ownerId !== userId) ||
        activeSplits.some((split) => split.ownerId !== userId))
    )
      blockedBy = 'SHARED_HAS_DEBTS';
    const entries = active.filter((entry) => entry.counterparty.ownerId === userId);
    return {
      blockedBy,
      entries,
      activeSplits,
      withdrawsDebts: !blockedBy && (entries.length > 0 || activeSplits.length > 0),
    };
  }

  /** 列出帳本的所有成員。存取權限在上游把關。 */
  async listMembers(ledgerId: string): Promise<LedgerMemberInfo[]> {
    const members = await this.prisma.ledgerMember.findMany({
      where: { ledgerId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => this.toMemberInfo(member));
  }

  /**
   * 先把 email 或呼叫者自己的已連動對象解析成帳號，再共用同一條 userId 加入路徑。
   *
   * **私人帳本一律擋下，owner 本人也不例外**——那不是權限不足，是帳本的類型不允許。
   * 前端不會為私人帳本畫出「新增成員」的按鈕，但那只是體驗：Swagger UI 就開在
   * `/docs`，規則若不寫在這裡就等於不存在。
   *
   * 檢查順序有意義：帳本類型排在「查詢目標使用者」之前。反過來的話，對私人帳本送
   * 一個沒註冊的 email 會拿到 `USER_NOT_FOUND`，那洩漏了該 email 未註冊，而呼叫者
   * 本就無權對這本帳本做任何成員操作。
   */
  async addMember(
    ledgerId: string,
    input: AddMemberRequest,
    requesterUserId: string,
  ): Promise<LedgerMemberInfo> {
    await this.assertSharedLedger(ledgerId);

    let targetUserId: string;
    if ('email' in input) {
      const user = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.USER_NOT_FOUND,
          'No registered user with that email.',
        );
      }
      targetUserId = user.id;
    } else {
      const counterparty = await this.prisma.counterparty.findFirst({
        where: { id: input.counterpartyId, ownerId: requesterUserId },
        select: { id: true },
      });
      if (!counterparty) throw this.notFound();

      const link = await findLinkOfCounterparty(this.prisma, input.counterpartyId);
      if (!link) throw this.counterpartyNotLinked();
      targetUserId = otherSide(link, input.counterpartyId).userId;
    }

    return this.addMemberByUserId(ledgerId, targetUserId, input.role);
  }

  /** email 與對象入口都在此處檢查成員狀態，並原子建立成員與沿用帳本人物資料。 */
  private async addMemberByUserId(
    ledgerId: string,
    targetUserId: string,
    role: LedgerRole,
  ): Promise<LedgerMemberInfo> {
    const existing = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_MEMBER,
        'User is already a member of this ledger.',
      );
    }

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ledgerMember.create({
        data: { ledgerId, userId: targetUserId, role },
        include: { user: true },
      });
      await this.ledgerPeople.ensureMemberPerson(tx, ledgerId, targetUserId);
      return created;
    });
    return this.toMemberInfo(member);
  }

  private async assertSharedLedger(ledgerId: string): Promise<void> {
    const ledger = await this.prisma.ledger.findUnique({ where: { id: ledgerId } });
    if (!ledger) {
      throw this.notFound();
    }
    if (ledger.kind === 'PERSONAL') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PERSONAL_LEDGER_CANNOT_SHARE,
        'This is a personal ledger; create a shared ledger to record with others.',
      );
    }
  }

  private counterpartyNotLinked(): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.COUNTERPARTY_NOT_LINKED,
      'This counterparty is not linked to another user.',
    );
  }

  /**
   * 變更成員角色。降級帳本最後一位 owner 會被拒絕，以確保帳本永遠至少有一位
   * owner。owner 數量在交易內重查，避免與並行變更發生競態。
   */
  async updateMemberRole(
    ledgerId: string,
    targetUserId: string,
    role: LedgerRole,
  ): Promise<LedgerMemberInfo> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (target.role === 'OWNER' && role !== 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      const updated = await tx.ledgerMember.update({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
        data: { role },
        include: { user: true },
      });
      return this.toMemberInfo(updated);
    });
  }

  /**
   * 移除成員。使用者永遠可以移除自己（退出）；移除他人則要求操作者是 owner。
   * 最後一位 owner 不可被移除。
   */
  async removeMember(ledgerId: string, targetUserId: string, actingUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (targetUserId !== actingUserId) {
        const acting = await tx.ledgerMember.findUnique({
          where: { ledgerId_userId: { ledgerId, userId: actingUserId } },
        });
        if (!acting || acting.role !== 'OWNER') {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            ErrorCode.CANNOT_MANAGE_OTHER_MEMBER,
            'Only an owner can remove another member.',
          );
        }
      }

      if (target.role === 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      await tx.ledgerMember.delete({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
    });
  }

  // 帳本永遠至少一位 owner 的守門：owner 數 <= 1 時擋下降級／移除動作。
  private async assertNotLastOwner(tx: Prisma.TransactionClient, ledgerId: string): Promise<void> {
    const owners = await tx.ledgerMember.count({
      where: { ledgerId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.LAST_OWNER_CANNOT_LEAVE,
        'A ledger must always have at least one owner.',
      );
    }
  }

  private toMemberInfo(member: MemberRow): LedgerMemberInfo {
    return {
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
    };
  }

  private memberNotFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Member not found.');
  }

  private toLedger(ledger: LedgerRow) {
    return {
      id: ledger.id,
      name: ledger.name,
      currency: ledger.currency,
      kind: ledger.kind,
      archivedAt: ledger.archivedAt?.toISOString() ?? null,
      createdAt: ledger.createdAt.toISOString(),
    };
  }

  private toSummary(ledger: LedgerRow, role: LedgerRole): LedgerSummary {
    return { ...this.toLedger(ledger), role };
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
}
