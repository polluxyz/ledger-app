import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DebtTransactionType,
  ErrorCode,
  computeSharesByKey,
  isDebtTransactionType,
  ListTransactionsQuery,
  ManualTransactionType,
  Paginated,
  Transaction,
  TransactionDebtRef,
  TransactionRef,
  TransactionType,
  TransactionSplitRef,
  LedgerSplitInput,
  LedgerPerson as LedgerPersonView,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveSync } from '../debts/debt-proposal-rules';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { isAccountPending, resolvePayerAccount } from '../ledger-people/payer-account-rules';

/**
 * 交易的業務邏輯——整個記帳系統的核心。呼叫進來之前，controller 已完成身分驗證
 * 與帳本角色授權，因此這裡每個方法拿到的 `ledgerId` 都是呼叫者有權使用的，且所有
 * 查詢都限定在該帳本內；交易絕不會被跨帳本讀寫。
 *
 * 以下貫穿全檔的規則：
 *   - 金額為正整數（在 DTO 驗證），絕不用浮點數。
 *   - 刪除採軟刪除（設 `deletedAt`）；每個讀取都以 `deletedAt: null` 過濾。
 *   - 分類與帳戶是**條件必填**：該不該填取決於交易型別與帳本的 `tracksBalance`，
 *     完整規則見 `assertAccountRules`。
 *   - 帳戶屬於使用者（不是帳本）；共享帳本的收支依付款人決定帳戶，
 *     而回應中別人的帳戶一律遮成 `null`（見 `toTransaction`）。
 */

// 分頁預設值與每頁筆數上限（客戶端要求超過 MAX_LIMIT 時會被夾住，而非報錯）。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 交易所引用的帳戶資料列；多帶 `userId` 是為了判斷該不該對檢視者顯示。 */
interface AccountRef {
  id: string;
  name: string;
  userId: string;
}

/** 一筆交易資料列，已 join 其分類、帳戶與建立者。 */
interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  note: string | null;
  title: string | null;
  splitId: string | null;
  payerPersonId?: string | null;
  ledgerSplit?: {
    id: string;
    method: 'EQUAL' | 'AMOUNT' | 'RATIO';
    precision: 'CENT' | 'YUAN';
    shares: Array<{ personId: string; share: number; ratio: number | null; sortOrder: number }>;
  } | null;
  settlement?: { id: string; fromPersonId: string; toPersonId: string } | null;
  createdAt: Date;
  category: { id: string; name: string; icon: string | null } | null;
  account: AccountRef | null;
  toAccount: AccountRef | null;
  creator: { id: string; name: string };
  // 借還帳（3b 往來帳版）：外鍵在往來紀錄那一側，所以從交易反查。只取回應要用的欄位，
  // 加上判斷「檢視者是不是擁有者」的 ownerId。
  debtEntry: {
    id: string;
    pairedEntryId: string | null;
    kind: import('@ledger/shared').DebtEntryKind;
    note: string | null;
    counterparty: {
      id: string;
      name: string | null;
      ownerId: string;
      linkAsLow?: { userHigh: { name: string } } | null;
      linkAsHigh?: { userLow: { name: string } } | null;
    };
  } | null;
  split?: {
    id: string;
    ownerId: string;
    type: 'EXPENSE' | 'INCOME';
    total: number;
    payerCounterpartyId: string | null;
    payer: {
      id: string;
      name: string | null;
      linkAsLow?: { userHigh: { name: string } } | null;
      linkAsHigh?: { userLow: { name: string } } | null;
    } | null;
    participants: Array<{ counterpartyId: string | null; share: number }>;
    entries: Array<{
      counterpartyId: string;
      delta: number;
      pairedEntryId: string | null;
      id: string;
      deletedAt: Date | null;
      counterparty: {
        name: string | null;
        linkAsLow?: { userHigh: { name: string } } | null;
        linkAsHigh?: { userLow: { name: string } } | null;
      };
      proposalsAsSource?: Array<{ status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' }>;
    }>;
  } | null;
}

// 共用的 Prisma `include`，讓每個讀取都回傳相同的 join 形狀。帳戶多選一個
// `userId`——遮蔽他人帳戶時需要它來比對檢視者，其他欄位一概不取。
const TRANSACTION_INCLUDE = {
  ledgerSplit: { include: { shares: { orderBy: { sortOrder: 'asc' } } } },
  settlement: true,
  category: { select: { id: true, name: true, icon: true } },
  account: { select: { id: true, name: true, userId: true } },
  toAccount: { select: { id: true, name: true, userId: true } },
  creator: { select: { id: true, name: true } },
  debtEntry: {
    select: {
      id: true,
      pairedEntryId: true,
      kind: true,
      note: true,
      counterparty: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          linkAsLow: { select: { userHigh: { select: { name: true } } } },
          linkAsHigh: { select: { userLow: { select: { name: true } } } },
        },
      },
    },
  },
  split: {
    include: {
      payer: {
        select: {
          id: true,
          name: true,
          linkAsLow: { select: { userHigh: { select: { name: true } } } },
          linkAsHigh: { select: { userLow: { select: { name: true } } } },
        },
      },
      participants: { select: { counterpartyId: true, share: true } },
      entries: {
        select: {
          id: true,
          counterpartyId: true,
          delta: true,
          pairedEntryId: true,
          deletedAt: true,
          counterparty: {
            select: {
              name: true,
              linkAsLow: { select: { userHigh: { select: { name: true } } } },
              linkAsHigh: { select: { userLow: { select: { name: true } } } },
            },
          },
          proposalsAsSource: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  },
} as const;

interface CreateTransactionInput {
  type: ManualTransactionType;
  amount: number;
  date: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  note?: string;
  title?: string;
  payerPersonId?: string;
  ledgerSplit?: LedgerSplitInput | null;
}

interface UpdateTransactionInput {
  type?: ManualTransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  note?: string;
  title?: string;
  payerPersonId?: string;
  ledgerSplit?: LedgerSplitInput | null;
}

interface ViewContext {
  shared: boolean;
  tracksBalance: boolean;
  people: Map<string, LedgerPersonView>;
  byUser: Map<string, LedgerPersonView>;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: LedgerPeopleService,
  ) {}

  /**
   * 在帳本中記下一筆交易。分類與帳戶各自的必填與否，取決於交易型別與帳本設定；
   * 完整規則見 `assertAccountRules`。
   */
  async create(
    ledgerId: string,
    creatorId: string,
    input: CreateTransactionInput,
  ): Promise<Transaction> {
    const ledger = await this.getLedger(ledgerId);
    this.assertSplitAllowed(input, ledger.kind, input.type);
    if (ledger.kind === 'SHARED' && this.isIncomeExpense(input.type)) {
      if (input.toAccountId !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'toAccountId is only valid for a transfer.',
        );
      }
      const createdId = await this.prisma.$transaction(async (tx) => {
        const caller = await this.people.findCallerPerson(tx, ledgerId, creatorId);
        if (!caller) throw this.notFound('Person');
        const payerId = input.payerPersonId ?? caller.id;
        const split =
          input.ledgerSplit === undefined
            ? {
                method: 'EQUAL' as const,
                shares: (await this.people.listPeople(tx, ledgerId))
                  .filter((person) => person.status !== 'LEFT')
                  .map((person) => ({ personId: person.id })),
              }
            : input.ledgerSplit;
        const records = await this.people.lockPeople(
          tx,
          ledgerId,
          [payerId, ...(split?.shares.map((share) => share.personId) ?? [])],
          { allowLeft: false },
        );
        const payer = records.get(payerId)!;
        const accountId = await this.resolveAccount({
          tracksBalance: ledger.tracksBalance,
          payer,
          callerUserId: creatorId,
          requestedAccountId: input.accountId,
          mode: 'CREATE',
          payerChanged: true,
          currentAccountId: null,
        });
        await this.assertCategoryRules(ledgerId, input.type, input.categoryId);
        const shares = split ? this.computeShares(split, input.amount, payerId) : null;
        const created = await tx.transaction.create({
          data: {
            ledgerId,
            creatorId,
            payerPersonId: payerId,
            categoryId: input.categoryId!,
            accountId,
            toAccountId: null,
            type: input.type,
            amount: input.amount,
            date: new Date(input.date),
            note: input.note ?? null,
            title: input.title ?? null,
          },
          select: { id: true },
        });
        if (split && shares) await this.writeLedgerSplit(tx, created.id, split, shares);
        return created.id;
      });
      return this.getById(ledgerId, createdId, creatorId);
    }
    // 建立時，「最終值」與「這次指定的值」是同一組。
    await this.assertAccountRules(ledgerId, creatorId, input.type, input, input);
    await this.assertCategoryRules(ledgerId, input.type, input.categoryId);

    const transaction = await this.prisma.transaction.create({
      data: {
        ledgerId,
        creatorId,
        categoryId: input.categoryId ?? null,
        accountId: input.accountId ?? null,
        toAccountId: input.toAccountId ?? null,
        type: input.type,
        amount: input.amount,
        date: new Date(input.date),
        note: input.note ?? null,
        title: input.title ?? null,
      },
      include: TRANSACTION_INCLUDE,
    });
    return this.toTransaction(transaction, creatorId);
  }

  /**
   * 回傳帳本中未刪除交易的其中一頁，新到舊排序，並套用可選的日期區間／分類／
   * 型別篩選。`viewerUserId` 用來遮蔽其他成員的帳戶。
   */
  async list(
    ledgerId: string,
    viewerUserId: string,
    query: ListTransactionsQuery,
  ): Promise<Paginated<Transaction>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // SQL 先依分帳擁有者合併，再篩選、分頁與計數；先取交易再在記憶體合併會讓
    // 第 2 頁筆數和 total 都錯。其他帳本成員的 s 為 null，因此逐筆看見原交易。
    const selected = await this.prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
      WITH ranked AS (
        SELECT t."id", COALESCE(s."date", t."date") AS "sortDate", t."createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN s."id" IS NULL THEN t."id" ELSE s."id" END
            ORDER BY CASE WHEN t."type"::text IN ('EXPENSE', 'INCOME') THEN 0 ELSE 1 END, t."createdAt", t."id"
          ) AS rn
        FROM "Transaction" t
        LEFT JOIN "Split" s ON s."id" = t."splitId" AND s."ownerId" = ${viewerUserId} AND s."deletedAt" IS NULL
        WHERE t."ledgerId" = ${ledgerId} AND t."deletedAt" IS NULL
          ${query.payerPersonId ? Prisma.sql`AND t."type"::text IN ('EXPENSE', 'INCOME') AND COALESCE(t."payerPersonId", (SELECT lp."id" FROM "LedgerPerson" lp WHERE lp."ledgerId" = t."ledgerId" AND lp."userId" = t."creatorId")) = ${query.payerPersonId}` : Prisma.empty}
          ${query.type ? Prisma.sql`AND COALESCE(s."type"::text, t."type"::text) = ${query.type}` : Prisma.empty}
          ${query.categoryId ? Prisma.sql`AND COALESCE(s."categoryId", t."categoryId") = ${query.categoryId}` : Prisma.empty}
          ${query.from ? Prisma.sql`AND COALESCE(s."date", t."date") >= ${new Date(query.from)}` : Prisma.empty}
          ${query.to ? Prisma.sql`AND COALESCE(s."date", t."date") <= ${new Date(query.to)}` : Prisma.empty}
      ), visible AS (
        SELECT "id", "sortDate", "createdAt" FROM ranked WHERE rn = 1
      )
      SELECT "id", COUNT(*) OVER() AS total FROM visible
      ORDER BY "sortDate" DESC, "createdAt" DESC, "id" DESC
      OFFSET ${(page - 1) * limit} LIMIT ${limit}
    `);
    const rows = selected.length
      ? await this.prisma.transaction.findMany({
          where: { id: { in: selected.map((item) => item.id) } },
          include: TRANSACTION_INCLUDE,
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const total = selected.length
      ? Number(selected[0]!.total)
      : Number(
          (
            await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT CASE WHEN s."id" IS NULL THEN t."id" ELSE s."id" END) AS count
      FROM "Transaction" t LEFT JOIN "Split" s ON s."id" = t."splitId" AND s."ownerId" = ${viewerUserId} AND s."deletedAt" IS NULL
      WHERE t."ledgerId" = ${ledgerId} AND t."deletedAt" IS NULL
        ${query.payerPersonId ? Prisma.sql`AND t."type"::text IN ('EXPENSE', 'INCOME') AND COALESCE(t."payerPersonId", (SELECT lp."id" FROM "LedgerPerson" lp WHERE lp."ledgerId" = t."ledgerId" AND lp."userId" = t."creatorId")) = ${query.payerPersonId}` : Prisma.empty}
        ${query.type ? Prisma.sql`AND COALESCE(s."type"::text, t."type"::text) = ${query.type}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND COALESCE(s."categoryId", t."categoryId") = ${query.categoryId}` : Prisma.empty}
        ${query.from ? Prisma.sql`AND COALESCE(s."date", t."date") >= ${new Date(query.from)}` : Prisma.empty}
        ${query.to ? Prisma.sql`AND COALESCE(s."date", t."date") <= ${new Date(query.to)}` : Prisma.empty}
    `)
          )[0]?.count ?? 0n,
        );

    const context = await this.viewContext(ledgerId);
    return {
      items: selected.map((item) => this.toTransaction(byId.get(item.id)!, viewerUserId, context)),
      page,
      limit,
      total,
    };
  }

  /**
   * 部分更新一筆交易（共享帳本模型：任何 editor 都可編輯任何一筆）。合併後的
   * 型別、分類、帳戶會被整組重新驗證，確保更新不會把交易帶進非法狀態。
   *
   * 「把支出改成轉帳」時分類必須消失，但 PATCH 的請求型別表達不出「清空」
   * （`undefined` 代表不動）。因此改成 `TRANSFER` 時由 service **自動**把
   * `categoryId` 設為 null——客戶端毋須理解 `undefined` 與 `null` 的差別，
   * 也就不可能送出「轉帳卻帶著分類」這種我們明文禁止的狀態。
   */
  async update(
    ledgerId: string,
    transactionId: string,
    viewerUserId: string,
    input: UpdateTransactionInput,
  ): Promise<Transaction> {
    const ledger = await this.getLedger(ledgerId);
    if (ledger.kind === 'SHARED') {
      return this.updateShared(ledgerId, transactionId, viewerUserId, input, ledger.tracksBalance);
    }
    this.assertSplitAllowed(input, ledger.kind, input.type ?? 'EXPENSE');
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      await this.assertNotSettlement(existing.id, tx);
      if (existing.splitId != null)
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SPLIT_TRANSACTION_READ_ONLY,
          'Change this transaction through its split.',
        );
      await this.assertNotDebtTransaction(existing.id, existing.type, tx);

      const finalType = input.type ?? existing.type;
      const becomesTransfer = finalType === 'TRANSFER';
      // 轉成 TRANSFER 時分類一律清空；否則沿用送來的值，沒送就維持原值。
      const finalCategoryId = becomesTransfer
        ? undefined
        : (input.categoryId ?? existing.categoryId ?? undefined);
      const finalAccountId = input.accountId ?? existing.accountId ?? undefined;
      const finalToAccountId = becomesTransfer
        ? (input.toAccountId ?? existing.toAccountId ?? undefined)
        : undefined;

      // 所有權只檢查「這次指定的」帳戶。共享帳本裡任何 editor 都可編輯任何一筆
      // （決策 8），若連沿用不動的既有帳戶也要求屬於編輯者，就等於沒有人能改別人
      // 記的帳——那是我們刻意允許的行為。
      await this.assertAccountRules(
        ledgerId,
        viewerUserId,
        finalType,
        { accountId: finalAccountId, toAccountId: finalToAccountId },
        { accountId: input.accountId, toAccountId: input.toAccountId },
      );
      await this.assertCategoryRules(ledgerId, finalType, finalCategoryId);

      return tx.transaction.update({
        where: { id: transactionId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          categoryId: finalCategoryId ?? null,
          accountId: finalAccountId ?? null,
          toAccountId: finalToAccountId ?? null,
        },
        include: TRANSACTION_INCLUDE,
      });
    });
    return this.toTransaction(updated, viewerUserId);
  }

  /** 軟刪除一筆交易（設 deletedAt）；資料列保留以利稽核。 */
  async remove(ledgerId: string, transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      await this.assertNotSettlement(existing.id, tx);
      if (existing.splitId != null)
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SPLIT_TRANSACTION_READ_ONLY,
          'Change this transaction through its split.',
        );
      await this.assertNotDebtTransaction(existing.id, existing.type);
      await tx.transaction.update({
        where: { id: transactionId },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async updateShared(
    ledgerId: string,
    transactionId: string,
    callerUserId: string,
    input: UpdateTransactionInput,
    tracksBalance: boolean,
  ): Promise<Transaction> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      const finalType = input.type ?? existing.type;
      await this.assertNotSettlement(existing.id, tx);
      const debt = await tx.debtEntry.findUnique({
        where: { transactionId },
        select: { id: true },
      });
      this.assertSplitAllowed(input, 'SHARED', finalType, existing, debt !== null);
      if (existing.splitId) throw this.readOnly(ErrorCode.SPLIT_TRANSACTION_READ_ONLY);
      await this.assertNotDebtTransaction(existing.id, existing.type, tx);

      if (!this.isIncomeExpense(finalType)) {
        const finalAccountId = input.accountId ?? existing.accountId ?? undefined;
        const finalToAccountId = input.toAccountId ?? existing.toAccountId ?? undefined;
        await this.assertAccountRules(
          ledgerId,
          callerUserId,
          finalType,
          { accountId: finalAccountId, toAccountId: finalToAccountId },
          { accountId: input.accountId, toAccountId: input.toAccountId },
        );
        await tx.ledgerSplit.deleteMany({ where: { transactionId } });
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            categoryId: null,
            payerPersonId: null,
            accountId: finalAccountId ?? null,
            toAccountId: finalToAccountId ?? null,
          },
        });
        return;
      }

      const caller = await this.people.findCallerPerson(tx, ledgerId, callerUserId);
      if (!caller) throw this.notFound('Person');
      const creatorPerson = await this.people.findCallerPerson(tx, ledgerId, existing.creatorId);
      const currentPayerId = existing.payerPersonId ?? creatorPerson?.id;
      if (!currentPayerId && existing.type !== 'TRANSFER') throw this.notFound('Person');
      const payerId =
        input.payerPersonId ?? (existing.type === 'TRANSFER' ? caller.id : currentPayerId!);
      const payerChanged = existing.type === 'TRANSFER' || payerId !== currentPayerId;
      const saved = await tx.ledgerSplit.findUnique({
        where: { transactionId },
        include: { shares: { orderBy: { sortOrder: 'asc' } } },
      });
      const split: LedgerSplitInput | null =
        input.ledgerSplit !== undefined
          ? input.ledgerSplit
          : saved
            ? {
                method: saved.method,
                precision: saved.method === 'AMOUNT' ? undefined : saved.precision,
                shares: saved.shares.map((share) => ({
                  personId: share.personId,
                  ...(saved.method === 'AMOUNT' ? { amount: share.share } : {}),
                  ...(saved.method === 'RATIO' ? { ratio: share.ratio! } : {}),
                })),
              }
            : null;
      const allowLeft = new Set<string>([
        ...(saved?.shares.map((share) => share.personId) ?? []),
        ...(!payerChanged && currentPayerId ? [currentPayerId] : []),
      ]);
      const records = await this.people.lockPeople(
        tx,
        ledgerId,
        [payerId, ...(split?.shares.map((share) => share.personId) ?? [])],
        { allowLeft },
      );
      const accountId = await this.resolveAccount({
        tracksBalance,
        payer: records.get(payerId)!,
        callerUserId,
        requestedAccountId: input.accountId,
        mode: 'UPDATE',
        payerChanged,
        currentAccountId: existing.accountId,
      });
      const categoryId = input.categoryId ?? existing.categoryId ?? undefined;
      await this.assertCategoryRules(ledgerId, finalType, categoryId);
      if (input.toAccountId !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'toAccountId is only valid for a transfer.',
        );
      }
      const shares = split
        ? this.computeShares(split, input.amount ?? existing.amount, payerId)
        : null;
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          categoryId: categoryId!,
          payerPersonId: payerId,
          accountId,
          toAccountId: null,
        },
      });
      if (saved) {
        await tx.ledgerShare.deleteMany({ where: { ledgerSplitId: saved.id } });
        await tx.ledgerSplit.delete({ where: { id: saved.id } });
      }
      if (split && shares) await this.writeLedgerSplit(tx, transactionId, split, shares);
    });
    return this.getById(ledgerId, transactionId, callerUserId);
  }

  /**
   * 由往來紀錄產生的交易在一般交易端點是唯讀的（spec 3b 決策 4、§5.3）。改它的金額或
   * 刪掉它，往來餘額就會跟帳戶對不起來；要改請走往來帳端點，那裡會一起改紀錄與交易。
   *
   * 判斷依據是「有沒有往來紀錄指向它」：「對方幫我付」產生的是一般 `EXPENSE`，只看型別
   * 擋不到。型別那一條留著當第二道防線——借還型別的交易理論上一定有往來紀錄。
   *
   * 新增交易時擋不到這裡：create / update 的 DTO 只接受 `MANUAL_TRANSACTION_TYPES`，
   * 借還型別在驗證那一層就回 400。這裡擋的是「對既有的這類交易動手」。
   */
  private async assertNotDebtTransaction(
    transactionId: string,
    type: TransactionType,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const entry = await client.debtEntry.findUnique({
      where: { transactionId },
      select: { id: true },
    });
    if (entry !== null || isDebtTransactionType(type)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.DEBT_TRANSACTION_READ_ONLY,
        'This transaction comes from a debt entry; change it through the entry instead.',
      );
    }
  }

  private async getLedger(ledgerId: string) {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      select: { kind: true, tracksBalance: true },
    });
    if (!ledger) throw this.notFound('Ledger');
    return ledger;
  }

  private isIncomeExpense(type: TransactionType): type is 'EXPENSE' | 'INCOME' {
    return type === 'EXPENSE' || type === 'INCOME';
  }

  private assertSplitAllowed(
    input: { payerPersonId?: string; ledgerSplit?: LedgerSplitInput | null },
    kind: 'PERSONAL' | 'SHARED',
    type: TransactionType,
    existing?: { splitId: string | null; type: TransactionType },
    hasDebt = false,
  ): void {
    if (input.payerPersonId === undefined && input.ledgerSplit === undefined) return;
    if (
      kind !== 'SHARED' ||
      !this.isIncomeExpense(type) ||
      existing?.splitId != null ||
      hasDebt ||
      (existing && isDebtTransactionType(existing.type))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.LEDGER_SPLIT_NOT_ALLOWED,
        'Payer and ledger split are not allowed for this transaction.',
      );
    }
  }

  private computeShares(split: LedgerSplitInput, total: number, payerId: string): number[] {
    if (
      (split.method === 'AMOUNT' && split.precision !== undefined) ||
      split.shares.some((share) =>
        split.method === 'AMOUNT'
          ? share.amount === undefined || share.ratio !== undefined
          : split.method === 'RATIO'
            ? share.ratio === undefined || share.amount !== undefined
            : share.amount !== undefined || share.ratio !== undefined,
      )
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SPLIT_PARTICIPANTS_INVALID,
        'Invalid ledger split fields.',
      );
    }
    const result = computeSharesByKey({
      total,
      method: split.method,
      precision: split.precision,
      payerKey: payerId,
      participants: split.shares.map((share) => ({
        key: share.personId,
        amount: share.amount,
        ratio: share.ratio,
      })),
    });
    if (!result.ok) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode[result.error],
        'Invalid ledger split.',
      );
    }
    return result.shares;
  }

  private async writeLedgerSplit(
    tx: Prisma.TransactionClient,
    transactionId: string,
    split: LedgerSplitInput,
    shares: number[],
  ): Promise<void> {
    await tx.ledgerSplit.create({
      data: {
        transactionId,
        method: split.method,
        precision: split.precision ?? 'CENT',
        shares: {
          create: split.shares.map((person, index) => ({
            personId: person.personId,
            share: shares[index]!,
            ratio: split.method === 'RATIO' ? person.ratio! : null,
            sortOrder: index,
          })),
        },
      },
    });
  }

  private async resolveAccount(
    input: Parameters<typeof resolvePayerAccount>[0],
  ): Promise<string | null> {
    const result = resolvePayerAccount(input);
    if (!result.ok) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode[result.error],
        'Invalid payer account.',
      );
    }
    if (result.needsOwnershipCheck)
      await this.assertAccountOwned(input.callerUserId, result.accountId!);
    return result.accountId;
  }

  private async findActiveForUpdate(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    transactionId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Transaction"
      WHERE "id" = ${transactionId} AND "ledgerId" = ${ledgerId} AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    if (rows.length !== 1) throw this.notFound('Transaction');
    const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
    return existing!;
  }

  private async assertNotSettlement(
    transactionId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const row = await client.ledgerSettlement.findUnique({
      where: { transactionId },
      select: { id: true },
    });
    if (row) throw this.readOnly(ErrorCode.SETTLEMENT_TRANSACTION_READ_ONLY);
  }

  private readOnly(code: ErrorCode): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      code,
      'Change this transaction through its source.',
    );
  }

  private notFound(resource: string): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${resource} not found.`);
  }

  async setAccount(
    ledgerId: string,
    transactionId: string,
    callerUserId: string,
    accountId: string,
  ): Promise<Transaction> {
    const ledger = await this.getLedger(ledgerId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      await this.assertNotSettlement(transactionId, tx);
      const debt = await tx.debtEntry.findUnique({
        where: { transactionId },
        select: { id: true },
      });
      if (
        ledger.kind !== 'SHARED' ||
        !this.isIncomeExpense(existing.type) ||
        existing.splitId ||
        debt
      ) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.LEDGER_SPLIT_NOT_ALLOWED,
          'Account cannot be set here.',
        );
      }
      if (!ledger.tracksBalance) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_NOT_ALLOWED,
          'This ledger does not track accounts.',
        );
      }
      const creator = await this.people.findCallerPerson(tx, ledgerId, existing.creatorId);
      const payerId = existing.payerPersonId ?? creator?.id;
      if (!payerId) throw this.notFound('Person');
      const people = await this.people.lockPeople(tx, ledgerId, [payerId], { allowLeft: true });
      if (people.get(payerId)!.userId !== callerUserId) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_NOT_PAYERS,
          'Only the payer can set this account.',
        );
      }
      await this.assertAccountOwned(callerUserId, accountId);
      await tx.transaction.update({ where: { id: transactionId }, data: { accountId } });
    });
    return this.getById(ledgerId, transactionId, callerUserId);
  }

  // ── 借還帳（3b）專用。只給 DebtsModule 呼叫，沒有對應的 HTTP 端點。 ──────────

  /**
   * 在呼叫端的資料庫交易（`client`）裡寫一筆借還交易，回傳它的 id。
   *
   * **帳本權限不在這裡檢查**：呼叫端必須先用 `assertLedgerWritable` 確認呼叫者至少是
   * EDITOR、帳本未封存。這裡只沿用一般交易的帳戶規則——連動帳本必填帳戶、非連動帳本
   * 不可填、帳戶必須屬於本人（`assertAccountRules`）。借還交易沒有分類。
   */
  async createDebtTransaction(
    client: Prisma.TransactionClient,
    input: {
      ledgerId: string;
      creatorId: string;
      type: DebtTransactionType;
      amount: number;
      date: Date;
      accountId?: string;
      title?: string | null;
      splitId?: string;
    },
  ): Promise<string> {
    const accounts = { accountId: input.accountId };
    await this.assertAccountRules(input.ledgerId, input.creatorId, input.type, accounts, accounts);

    const created = await client.transaction.create({
      data: {
        ledgerId: input.ledgerId,
        creatorId: input.creatorId,
        type: input.type,
        amount: input.amount,
        date: input.date,
        // 借還交易一律不帶備註：共享帳本的其他成員看得到這筆交易（決策 13），但往來紀錄的
        // 備註屬於擁有者的私人記錄（spec §3.5）。擁有者要看備註，從交易的 debt 回到往來帳即可。
        note: null,
        accountId: input.accountId ?? null,
        title: input.title ?? null,
        splitId: input.splitId ?? null,
        categoryId: null,
        toAccountId: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * 「對方幫我付」的支出（spec 3b 決策 36）：一般 `EXPENSE`，有分類，但**不填帳戶**——錢是
   * 對方出的，我的帳戶不動。這是唯一允許連動帳本的支出不填帳戶的入口，只給 DebtsModule 用；
   * 一般交易端點的帳戶規則完全不變。
   *
   * 帳本權限同樣由呼叫端先檢查（`assertLedgerWritable`）。分類沿用一般交易的規則：
   * 必須屬於這本帳本、而且是支出分類。
   */
  async createPaidForMeExpense(
    client: Prisma.TransactionClient,
    input: {
      ledgerId: string;
      creatorId: string;
      amount: number;
      date: Date;
      categoryId: string;
      type?: 'EXPENSE' | 'INCOME';
      title?: string | null;
      splitId?: string;
    },
  ): Promise<string> {
    await this.assertCategoryRules(input.ledgerId, input.type ?? 'EXPENSE', input.categoryId);

    const created = await client.transaction.create({
      data: {
        ledgerId: input.ledgerId,
        creatorId: input.creatorId,
        type: input.type ?? 'EXPENSE',
        amount: input.amount,
        date: input.date,
        // 與借還交易同理：往來紀錄的備註是私人的，不帶進共享帳本看得到的交易。
        note: null,
        accountId: null,
        title: input.title ?? null,
        splitId: input.splitId ?? null,
        categoryId: input.categoryId,
        toAccountId: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** 分帳中我那份仍是一般收支；在呼叫端交易內沿用同一組帳戶與分類驗證。 */
  async createSplitShareTransaction(
    client: Prisma.TransactionClient,
    input: {
      ledgerId: string;
      creatorId: string;
      type: 'EXPENSE' | 'INCOME';
      amount: number;
      date: Date;
      categoryId: string;
      accountId?: string;
      title?: string | null;
      splitId: string;
    },
  ): Promise<string> {
    await this.assertCategoryRules(input.ledgerId, input.type, input.categoryId);
    await this.assertAccountRules(
      input.ledgerId,
      input.creatorId,
      input.type,
      { accountId: input.accountId },
      { accountId: input.accountId },
    );
    const row = await client.transaction.create({
      data: {
        ledgerId: input.ledgerId,
        creatorId: input.creatorId,
        type: input.type,
        amount: input.amount,
        date: input.date,
        categoryId: input.categoryId,
        accountId: input.accountId ?? null,
        toAccountId: null,
        note: null,
        title: input.title ?? null,
        splitId: input.splitId,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** 往來紀錄的金額或日期改了，對應的交易一起改。只動金額與日期，帳本、帳戶、分類不變。 */
  async updateDebtTransaction(
    client: Prisma.TransactionClient,
    transactionId: string,
    input: { amount?: number; date?: Date },
  ): Promise<void> {
    await client.transaction.update({
      where: { id: transactionId },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
      },
    });
  }

  /** 刪除往來紀錄時，對應的交易一起軟刪除。已刪除的不會被重設時間。 */
  async softDeleteDebtTransactions(
    client: Prisma.TransactionClient,
    transactionIds: string[],
    deletedAt: Date,
  ): Promise<void> {
    if (transactionIds.length === 0) {
      return;
    }
    await client.transaction.updateMany({
      where: { id: { in: transactionIds }, deletedAt: null },
      data: { deletedAt },
    });
  }

  /**
   * 分類的條件必填規則：
   *   - `EXPENSE` / `INCOME`：必填，且須屬同帳本、型別一致；
   *   - `TRANSFER`：不可填——「從銀行領錢到皮夾」不屬於任何消費類別，
   *     若允許帶分類，這筆錢就會出現在支出統計裡，但它其實沒有離開你。
   */
  private async assertCategoryRules(
    ledgerId: string,
    type: TransactionType,
    categoryId: string | undefined,
  ): Promise<void> {
    if (type === 'TRANSFER') {
      if (categoryId !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'A transfer cannot have a category.',
        );
      }
      return;
    }

    if (categoryId === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'categoryId is required for expense and income transactions.',
      );
    }

    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    // 分類不屬於此帳本時回 404（而非 400）：不洩漏它是否存在。
    if (!category || category.ledgerId !== ledgerId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Category not found.');
    }
    // 走到這裡 type 已被前面的 early return 收斂成 EXPENSE / INCOME，正是分類的值域。
    if (category.type !== type) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CATEGORY_TYPE_MISMATCH,
        "The category's type does not match the transaction type.",
      );
    }
  }

  /**
   * 帳戶的條件必填規則。該不該填取決於帳本設定與交易型別：
   *
   * | 帳本       | 型別        | accountId | toAccountId |
   * | ---------- | ----------- | --------- | ----------- |
   * | 連動       | 支出／收入  | 必填      | 不可填      |
   * | 連動       | 轉帳        | 必填      | 必填        |
   * | 非連動     | 支出／收入  | 不可填    | 不可填      |
   *
   * 「連動」＝帳本的 `tracksBalance` 為 true（預設）。連動帳本若允許不填帳戶，
   * 餘額就只會是「部分真實」——那等於不能信，也就失去了記餘額的意義。
   *
   * `final` 是套用這次請求後的最終值，用來判斷必填與否；`assigned` 是這次請求
   * **實際指定**的值，只有它才需要驗證所有權——沿用不動的既有帳戶可能屬於別的
   * 成員（共享帳本中任何 editor 都能編輯任何一筆），那是允許的。
   * 被指定的帳戶必須屬於**呼叫者本人**；別人的或不存在的一律回 404。
   */
  private async assertAccountRules(
    ledgerId: string,
    userId: string,
    type: TransactionType,
    final: { accountId?: string; toAccountId?: string },
    assigned: { accountId?: string; toAccountId?: string },
  ): Promise<void> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      select: { tracksBalance: true },
    });
    if (!ledger) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    if (!ledger.tracksBalance) {
      if (final.accountId !== undefined || final.toAccountId !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_NOT_ALLOWED,
          'This ledger does not track account balances, so transactions cannot name an account.',
        );
      }
      return;
    }

    if (final.accountId === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ACCOUNT_REQUIRED,
        'accountId is required in a ledger that tracks account balances.',
      );
    }

    if (type !== 'TRANSFER') {
      if (final.toAccountId !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'toAccountId is only valid for a transfer.',
        );
      }
    } else {
      if (final.toAccountId === undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_REQUIRED,
          'toAccountId is required for a transfer.',
        );
      }
      if (final.toAccountId === final.accountId) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.TRANSFER_SAME_ACCOUNT,
          'A transfer must move money between two different accounts.',
        );
      }
    }

    // 形狀合法後，才驗證這次「指定」的帳戶確實屬於呼叫者。
    for (const accountId of [assigned.accountId, assigned.toAccountId]) {
      if (accountId !== undefined) {
        await this.assertAccountOwned(userId, accountId);
      }
    }
  }

  /** 帳戶必須存在且屬於呼叫者；兩種失敗都回同樣的 404。 */
  private async assertAccountOwned(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!account || account.userId !== userId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Account not found.');
    }
  }

  /** 回傳帳本中某一筆未刪除的交易。 */
  async getById(
    ledgerId: string,
    transactionId: string,
    viewerUserId: string,
  ): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Transaction not found.');
    }
    const context = await this.viewContext(ledgerId);
    return this.toTransaction(transaction, viewerUserId, context);
  }

  private async viewContext(ledgerId: string): Promise<ViewContext> {
    const ledger = await this.getLedger(ledgerId);
    const context: ViewContext = {
      shared: ledger.kind === 'SHARED',
      tracksBalance: ledger.tracksBalance,
      people: new Map(),
      byUser: new Map(),
    };
    if (context.shared) {
      const records = await this.people.listPeople(this.prisma, ledgerId);
      for (const record of records) {
        const view = this.people.toView(record);
        context.people.set(record.id, view);
        if (record.userId) context.byUser.set(record.userId, view);
      }
    }
    return context;
  }

  /**
   * 把資料列轉成對外的交易形狀。
   *
   * `viewerUserId` **刻意沒有預設值**：帳戶欄位要不要遮蔽，取決於「誰在看」。
   * 若給了預設值，日後有人新增讀取路徑卻忘了傳，程式仍能編譯，而遮蔽會靜悄悄
   * 失效、洩漏他人的帳戶名稱。沒有預設值，型別系統就會強迫每個呼叫點交代清楚。
   */
  private toTransaction(
    row: TransactionRow,
    viewerUserId: string,
    context?: ViewContext,
  ): Transaction {
    const payer =
      context?.shared && this.isIncomeExpense(row.type)
        ? (context.people.get(row.payerPersonId ?? '') ??
          context.byUser.get(row.creator.id) ??
          null)
        : null;
    const settlement =
      row.settlement && context?.shared
        ? {
            id: row.settlement.id,
            from: context.people.get(row.settlement.fromPersonId)!,
            to: context.people.get(row.settlement.toPersonId)!,
          }
        : null;
    const ledgerSplit =
      row.ledgerSplit && context?.shared
        ? {
            method: row.ledgerSplit.method,
            precision: row.ledgerSplit.precision,
            shares: row.ledgerSplit.shares.map((share) => ({
              person: context.people.get(share.personId)!,
              share: share.share,
              ratio: share.ratio,
            })),
          }
        : null;
    const accountPending =
      settlement && context
        ? isAccountPending({
            tracksBalance: context.tracksBalance,
            payerUserId: settlement.from.userId,
            accountId: row.account?.id ?? null,
            viewerUserId,
          }) ||
          isAccountPending({
            tracksBalance: context.tracksBalance,
            payerUserId: settlement.to.userId,
            accountId: row.toAccount?.id ?? null,
            viewerUserId,
          })
        : payer && context && !row.splitId && !row.debtEntry
          ? isAccountPending({
              tracksBalance: context.tracksBalance,
              payerUserId: payer.userId,
              accountId: row.account?.id ?? null,
              viewerUserId,
            })
          : false;
    return {
      id: row.id,
      type: row.type,
      amount: row.amount,
      date: row.date.toISOString(),
      note: row.note,
      title: row.title,
      category: row.category
        ? {
            id: row.category.id,
            name: row.category.name,
            icon: row.category.icon as import('@ledger/shared').CategoryIcon | null,
          }
        : null,
      account: this.visibleAccount(row.account, viewerUserId),
      toAccount: this.visibleAccount(row.toAccount, viewerUserId),
      creator: { id: row.creator.id, name: row.creator.name },
      debt: this.visibleDebt(row, viewerUserId),
      split: this.visibleSplit(row, viewerUserId),
      payer,
      ledgerSplit,
      settlement,
      accountPending,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * 借還交易背後的債務 id，只給債務的擁有者看（spec 3b §3.5 最後一列）。
   *
   * 共享帳本的其他成員看得到這筆交易（決策 13），但債務是擁有者的個人記錄——連「它存在」
   * 都不該透露，所以對他們一律是 `null`，與一般交易無從區分。
   */
  private visibleDebt(row: TransactionRow, viewerUserId: string): TransactionDebtRef | null {
    const entry = row.debtEntry;
    // 用 `!entry` 而不是 `=== null`：只 select 部分欄位的舊呼叫端與測試替身可能根本沒有這個鍵。
    if (!entry || entry.counterparty.ownerId !== viewerUserId) {
      return null;
    }
    return {
      entryId: entry.id,
      kind: entry.kind,
      counterpartyId: entry.counterparty.id,
      counterpartyName:
        entry.counterparty.name ??
        entry.counterparty.linkAsLow?.userHigh.name ??
        entry.counterparty.linkAsHigh?.userLow.name ??
        '',
      paired: entry.pairedEntryId !== null,
      note: entry.note,
    };
  }

  /** 分帳明細只給建立者；共享帳本的其他成員仍可讀每一筆交易。 */
  private visibleSplit(row: TransactionRow, viewerUserId: string): TransactionSplitRef | null {
    const split = row.split;
    if (!split || split.ownerId !== viewerUserId) return null;
    const myShare = split.participants.find((person) => person.counterpartyId === null)?.share ?? 0;
    const entries = split.entries.filter((entry) => entry.deletedAt === null);
    return {
      id: split.id,
      type: split.type,
      total: split.total,
      myShare,
      payer: split.payer
        ? { counterpartyId: split.payer.id, name: this.counterpartyName(split.payer) }
        : null,
      counterparts: entries.map((entry) => ({
        counterpartyId: entry.counterpartyId,
        name: this.counterpartyName(entry.counterparty),
        amount: Math.abs(entry.delta),
        direction: entry.delta > 0 ? ('THEY_OWE_ME' as const) : ('I_OWE_THEM' as const),
        sync: deriveSync(entry.pairedEntryId !== null, entry.proposalsAsSource?.[0]?.status),
      })),
    };
  }

  private counterpartyName(row: {
    name: string | null;
    linkAsLow?: { userHigh: { name: string } } | null;
    linkAsHigh?: { userLow: { name: string } } | null;
  }): string {
    return row.name ?? row.linkAsLow?.userHigh.name ?? row.linkAsHigh?.userLow.name ?? '';
  }

  /**
   * 只有帳戶的主人看得到它。共享帳本中的協作需要的是金額、分類與記帳者，
   * 「你從哪個戶頭付的」既不必要、又可能敏感（帳戶名稱常帶著銀行與用途）。
   */
  private visibleAccount(account: AccountRef | null, viewerUserId: string): TransactionRef | null {
    if (!account || account.userId !== viewerUserId) {
      return null;
    }
    return { id: account.id, name: account.name };
  }
}
