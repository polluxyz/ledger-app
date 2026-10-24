import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CATEGORY_NAME_MAX_LENGTH,
  DebtTransactionType,
  ErrorCode,
  computeSharesByKey,
  debtCategoryTypeOf,
  isDebtTransactionType,
  ListTransactionsQuery,
  ListMarkedTransactionsQuery,
  MarkedTransaction,
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
import { CategoriesService } from '../categories/categories.service';
import { deriveSync } from '../debts/debt-proposal-rules';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { isAccountPending, resolvePayerAccount } from '../ledger-people/payer-account-rules';
import { assertSelectableAccount, temporaryAccountIdOf } from '../accounts/account-selection';

/**
 * 交易的業務邏輯——整個記帳系統的核心。呼叫進來之前，controller 已完成身分驗證
 * 與帳本角色授權，因此這裡每個方法拿到的 `ledgerId` 都是呼叫者有權使用的，且所有
 * 查詢都限定在該帳本內；交易絕不會被跨帳本讀寫。
 *
 * 以下貫穿全檔的規則：
 *   - 金額為正整數（在 DTO 驗證），絕不用浮點數。
 *   - 刪除採軟刪除（設 `deletedAt`）；每個讀取都以 `deletedAt: null` 過濾。
 *   - 分類與帳戶依交易型別驗證，所有帳本的交易都計入餘額，
 *     完整規則見 `assertAccountRules`。
 *   - 帳戶屬於使用者（不是帳本）；共享帳本的收支依付款人決定帳戶，
 *     而回應中別人的帳戶一律遮成 `null`（見 `toTransaction`）。
 */

// 分頁預設值與每頁筆數上限（客戶端要求超過 MAX_LIMIT 時會被夾住，而非報錯）。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `TransactionsService.list` 的內部選項——不是公開查詢參數，只有後端自己的端點能指定。
 * 對外開放會讓一般交易列表被「只看結清」這類檢視角度穿透，這裡刻意收在 service 邊界內。
 */
export interface ListTransactionsInternalOptions {
  /**
   * 結清清單（3g §4.2 `GET /ledgers/{id}/settlements`）專用：只取有 `LedgerSettlement`
   * 的交易。條件以 AND 加進 SQL，與退出範圍、分頁、`total` 一起受限，查詢參數放寬不了。
   */
  settlementsOnly?: boolean;
}

/** 交易所引用的帳戶資料列；多帶 `userId` 是為了判斷該不該對檢視者顯示。 */
interface AccountRef {
  id: string;
  name: string;
  userId: string;
}

/** 一筆交易資料列，已 join 其分類、帳戶與建立者。 */
interface TransactionRow {
  id: string;
  transactionMarks?: Array<{ userId: string }>;
  mergeId?: string | null;
  mergedFromId?: string | null;
  merge?: { userId: string; sourceLedgerName: string } | null;
  differenceOfId?: string | null;
  difference?: { id: string; type: TransactionType; amount: number; deletedAt: Date | null } | null;
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
  merge: { select: { userId: true, sourceLedgerName: true } },
  difference: { select: { id: true, type: true, amount: true, deletedAt: true } },
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

/** 只載入檢視者自己的標註，避免讀出其他成員的私人狀態，也避免逐筆查詢。 */
const transactionInclude = (viewerUserId: string) => ({
  ...TRANSACTION_INCLUDE,
  transactionMarks: { where: { userId: viewerUserId }, select: { userId: true } },
});

/** 合併的份額與代墊只顯示份額；一般列表與跨帳本標註列表共用這個 SQL 條件。 */
const mergedAdvanceExcluded = Prisma.sql`AND NOT (
  t."mergeId" IS NOT NULL AND t."type"::text IN ('LEND', 'BORROW')
  AND EXISTS (
    SELECT 1 FROM "Transaction" share
    WHERE share."ledgerId" = t."ledgerId" AND share."mergeId" = t."mergeId"
      AND share."mergedFromId" = t."mergedFromId" AND share."deletedAt" IS NULL
      AND ((share."type"::text = 'EXPENSE' AND t."type"::text = 'LEND')
        OR (share."type"::text = 'INCOME' AND t."type"::text = 'BORROW'))
  )
)`;

interface CreateTransactionInput {
  type: ManualTransactionType;
  amount: number;
  date: string;
  categoryId?: string;
  newCategoryName?: string;
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
  mergeRows?: Map<string, TransactionRow[]>;
  markRows?: Map<string, TransactionRow>;
  mergedOriginalIds?: Set<string>;
  shared: boolean;
  viewerTemporaryAccountId: string | null;
  people: Map<string, LedgerPersonView>;
  byUser: Map<string, LedgerPersonView>;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: LedgerPeopleService,
    private readonly categories: CategoriesService,
  ) {}

  /** 標註只改本人的列；代表 id 與單筆讀取共用，代墊 id 也會落在份額上。 */
  async setMarked(
    ledgerId: string,
    transactionId: string,
    userId: string,
    marked: boolean,
  ): Promise<void> {
    const member = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!member) throw this.notFound('Ledger');
    const { transaction, context } = await this.loadTransactionView(
      ledgerId,
      transactionId,
      userId,
    );
    const key = { userId, transactionId: this.markRepresentative(transaction, context).id };
    if (marked) {
      await this.prisma.transactionMark.upsert({
        where: { userId_transactionId: key },
        create: key,
        // 空 update 會讓 Prisma 先查再建；保留實際 update，交給資料庫原子 upsert。
        update: { userId },
      });
    } else {
      await this.prisma.transactionMark.deleteMany({ where: key });
    }
  }

  /** 跨帳本先篩選現任成員與本人標註，再分頁；每本帳本各自建立遮蔽與合併脈絡。 */
  async listMarked(
    viewerUserId: string,
    query: ListMarkedTransactionsQuery,
  ): Promise<Paginated<MarkedTransaction>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const visible = Prisma.sql`
      WITH ranked AS (
        SELECT t."id", COALESCE(s."date", t."date") AS "sortDate", t."createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN s."id" IS NULL THEN t."id" ELSE s."id" END
            ORDER BY CASE WHEN t."type"::text IN ('EXPENSE', 'INCOME') THEN 0 ELSE 1 END, t."createdAt", t."id"
          ) AS rn
        FROM "Transaction" t
        LEFT JOIN "Split" s ON s."id" = t."splitId" AND s."ownerId" = ${viewerUserId} AND s."deletedAt" IS NULL
        WHERE t."deletedAt" IS NULL AND t."differenceOfId" IS NULL
          AND EXISTS (SELECT 1 FROM "LedgerMember" member WHERE member."ledgerId" = t."ledgerId" AND member."userId" = ${viewerUserId})
          AND EXISTS (SELECT 1 FROM "TransactionMark" mark WHERE mark."transactionId" = t."id" AND mark."userId" = ${viewerUserId})
          ${mergedAdvanceExcluded}
      ), visible AS (
        SELECT "id", "sortDate", "createdAt" FROM ranked WHERE rn = 1
      )`;
    const selected = await this.prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
      ${visible}
      SELECT "id", COUNT(*) OVER() AS total FROM visible
      ORDER BY "sortDate" DESC, "createdAt" DESC, "id" DESC
      OFFSET ${(page - 1) * limit} LIMIT ${limit}
    `);
    const total = selected.length
      ? Number(selected[0]!.total)
      : Number(
          (
            await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          ${visible} SELECT COUNT(*) AS count FROM visible
        `)
          )[0]?.count ?? 0n,
        );
    const rows = selected.length
      ? await this.prisma.transaction.findMany({
          where: {
            id: { in: selected.map((item) => item.id) },
            deletedAt: null,
            ledger: { members: { some: { userId: viewerUserId } } },
          },
          include: {
            ...transactionInclude(viewerUserId),
            ledger: { select: { id: true, name: true } },
          },
        })
      : [];
    const contexts = new Map<string, ViewContext>();
    for (const ledgerId of new Set(rows.map((row) => row.ledgerId))) {
      const context = await this.viewContext(ledgerId, viewerUserId);
      await this.loadRowContext(
        ledgerId,
        viewerUserId,
        rows.filter((row) => row.ledgerId === ledgerId),
        context,
      );
      contexts.set(ledgerId, context);
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: selected.flatMap(({ id }) => {
        const row = byId.get(id);
        return row
          ? [
              {
                ...this.toTransaction(row, viewerUserId, contexts.get(row.ledgerId)),
                ledger: row.ledger,
              },
            ]
          : [];
      }),
      page,
      limit,
      total,
    };
  }

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
        // 表單可預設勾選全部人；API 省略名單仍表示不分帳。
        const split = input.ledgerSplit ?? null;
        const records = await this.people.lockPeople(
          tx,
          ledgerId,
          [payerId, ...(split?.shares.map((share) => share.personId) ?? [])],
          // 已離開的成員跟非成員一樣可以被選（3e spec 修訂 2、決策 134）；已刪除的非成員照擋。
          { allowLeft: true },
        );
        const payer = records.get(payerId)!;
        const accountId = await this.resolveAccount(tx, {
          payer,
          callerUserId: creatorId,
          requestedAccountId: input.accountId,
          mode: 'CREATE',
          payerChanged: true,
          currentAccountId: null,
        });
        const categoryId = await this.assertCategoryRules(
          tx,
          ledgerId,
          input.type,
          input.categoryId,
          input.newCategoryName,
        );
        const shares = split ? this.computeShares(split, input.amount, payerId) : null;
        const created = await tx.transaction.create({
          data: {
            ledgerId,
            creatorId,
            payerPersonId: payerId,
            categoryId,
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
    // 分類與交易一起提交；後續寫入失敗時，不留下使用者尚未成功確認的分類。
    const transaction = await this.prisma.$transaction(async (tx) => {
      // 建立時，「最終值」與「這次指定的值」是同一組。
      await this.assertAccountRules(ledgerId, creatorId, input.type, input, input, tx);
      const categoryId = await this.assertCategoryRules(
        tx,
        ledgerId,
        input.type,
        input.categoryId,
        input.newCategoryName,
      );
      return tx.transaction.create({
        data: {
          ledgerId,
          creatorId,
          categoryId,
          accountId: input.accountId ?? null,
          toAccountId: input.toAccountId ?? null,
          type: input.type,
          amount: input.amount,
          date: new Date(input.date),
          note: input.note ?? null,
          title: input.title ?? null,
        },
        include: transactionInclude(creatorId),
      });
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
    options: ListTransactionsInternalOptions = {},
  ): Promise<Paginated<Transaction>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const settlementsOnly = options.settlementsOnly === true;
    // 結清清單與交易清單共用現任成員的存取規則。
    const settlementOnly = settlementsOnly
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "LedgerSettlement" st
          WHERE st."transactionId" = t."id"
        )`
      : Prisma.empty;

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
        WHERE t."ledgerId" = ${ledgerId} AND t."deletedAt" IS NULL AND t."differenceOfId" IS NULL
          ${settlementOnly}
          ${mergedAdvanceExcluded}
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
          where: { ledgerId, deletedAt: null, id: { in: selected.map((item) => item.id) } },
          include: transactionInclude(viewerUserId),
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
      WHERE t."ledgerId" = ${ledgerId} AND t."deletedAt" IS NULL AND t."differenceOfId" IS NULL
        ${settlementOnly}
        ${mergedAdvanceExcluded}
        ${query.payerPersonId ? Prisma.sql`AND t."type"::text IN ('EXPENSE', 'INCOME') AND COALESCE(t."payerPersonId", (SELECT lp."id" FROM "LedgerPerson" lp WHERE lp."ledgerId" = t."ledgerId" AND lp."userId" = t."creatorId")) = ${query.payerPersonId}` : Prisma.empty}
        ${query.type ? Prisma.sql`AND COALESCE(s."type"::text, t."type"::text) = ${query.type}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND COALESCE(s."categoryId", t."categoryId") = ${query.categoryId}` : Prisma.empty}
        ${query.from ? Prisma.sql`AND COALESCE(s."date", t."date") >= ${new Date(query.from)}` : Prisma.empty}
        ${query.to ? Prisma.sql`AND COALESCE(s."date", t."date") <= ${new Date(query.to)}` : Prisma.empty}
    `)
          )[0]?.count ?? 0n,
        );

    const context = await this.viewContext(ledgerId, viewerUserId);
    await this.loadRowContext(ledgerId, viewerUserId, rows, context);
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
      return this.updateShared(ledgerId, transactionId, viewerUserId, input);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      if (existing.mergeId) {
        return this.updateMerged(tx, ledgerId, existing, viewerUserId, input);
      }
      this.assertSplitAllowed(input, ledger.kind, input.type ?? 'EXPENSE');
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
      await this.assertCategoryRules(tx, ledgerId, finalType, finalCategoryId);

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
        include: transactionInclude(viewerUserId),
      });
    });
    if (updated.mergeId) return this.getById(ledgerId, updated.id, viewerUserId);
    return this.toTransaction(updated, viewerUserId);
  }

  /** 軟刪除一筆交易（設 deletedAt）；資料列保留以利稽核。 */
  async remove(ledgerId: string, transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      if (existing.mergeId) {
        await tx.transaction.updateMany({
          where: {
            ledgerId,
            mergeId: existing.mergeId,
            mergedFromId: existing.mergedFromId,
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        });
        return;
      }
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
  ): Promise<Transaction> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActiveForUpdate(tx, ledgerId, transactionId);
      if (existing.mergeId) {
        await this.updateMerged(tx, ledgerId, existing, callerUserId, input);
        return;
      }
      await this.assertNotMergedAccountChange(tx, ledgerId, transactionId, callerUserId, input);
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
      // 已離開的成員跟非成員一樣可以被選（3e spec 修訂 2、決策 134）；已刪除的非成員照擋。
      const records = await this.people.lockPeople(
        tx,
        ledgerId,
        [payerId, ...(split?.shares.map((share) => share.personId) ?? [])],
        { allowLeft: true },
      );
      const accountId = await this.resolveAccount(tx, {
        payer: records.get(payerId)!,
        callerUserId,
        requestedAccountId: input.accountId,
        mode: 'UPDATE',
        payerChanged,
        currentAccountId: existing.accountId,
      });
      const categoryId = input.categoryId ?? existing.categoryId ?? undefined;
      await this.assertCategoryRules(tx, ledgerId, finalType, categoryId);
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
    const [entry, difference] = await Promise.all([
      client.debtEntry.findUnique({
        where: { transactionId },
        select: { id: true },
      }),
      client.transaction.findUnique({
        where: { id: transactionId },
        select: { differenceOfId: true },
      }),
    ]);
    if (entry !== null || difference?.differenceOfId != null || isDebtTransactionType(type)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.DEBT_TRANSACTION_READ_ONLY,
        'This transaction comes from a debt entry; change it through the entry instead.',
      );
    }
  }

  /** 合併交易只開放顯示名稱、目標帳本分類與呼叫者帳戶；兩個內部紀錄同步寫入。 */
  private async updateMerged(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    existing: Prisma.TransactionGetPayload<object>,
    callerUserId: string,
    input: UpdateTransactionInput,
  ) {
    const group = await tx.transaction.findMany({
      where: {
        ledgerId,
        mergeId: existing.mergeId,
        mergedFromId: existing.mergedFromId,
        deletedAt: null,
      },
    });
    const primary = group.find((row) => this.isIncomeExpense(row.type)) ?? existing;
    const amount = group.reduce((total, row) => total + row.amount, 0);
    const changed =
      (input.type !== undefined && input.type !== primary.type) ||
      (input.amount !== undefined && input.amount !== amount) ||
      (input.date !== undefined && new Date(input.date).getTime() !== primary.date.getTime()) ||
      (input.note !== undefined && input.note !== primary.note) ||
      (input.payerPersonId !== undefined && input.payerPersonId !== primary.payerPersonId) ||
      (input.ledgerSplit !== undefined && input.ledgerSplit !== null);
    if (changed) throw this.invalidMergedChange();
    for (const value of [input.title, input.categoryId, input.accountId, input.toAccountId]) {
      if (value !== undefined && typeof value !== 'string') throw this.invalidMergedChange();
    }

    if (input.categoryId !== undefined) {
      if (!this.isIncomeExpense(primary.type)) throw this.invalidMergedChange();
      await this.assertCategoryRules(tx, ledgerId, primary.type, input.categoryId);
    }
    if (input.toAccountId !== undefined && primary.type !== 'TRANSFER') {
      throw this.invalidMergedChange();
    }
    // 合併交易的帳戶只屬於合併者（spec §7 Never）。目標是共享帳本時其他編輯者可以改名稱與
    // 分類，但改帳戶會把他自己的帳戶寫進別人的合併帳。
    if (
      (input.accountId !== undefined || input.toAccountId !== undefined) &&
      (await tx.ledgerMerge.findUnique({
        where: { id: existing.mergeId! },
        select: { userId: true },
      }))!.userId !== callerUserId
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ACCOUNT_NOT_PAYERS,
        'Only the person who merged this transaction can change its account.',
      );
    }
    for (const accountId of [input.accountId, input.toAccountId]) {
      if (accountId !== undefined) await assertSelectableAccount(tx, callerUserId, accountId);
    }
    if (
      primary.type === 'TRANSFER' &&
      (input.accountId !== undefined || input.toAccountId !== undefined)
    ) {
      await this.assertAccountRules(
        ledgerId,
        callerUserId,
        primary.type,
        {
          accountId: input.accountId ?? primary.accountId ?? undefined,
          toAccountId: input.toAccountId ?? primary.toAccountId ?? undefined,
        },
        {},
        tx,
      );
    }
    await tx.transaction.updateMany({
      where: { ledgerId, id: { in: group.map((row) => row.id) }, deletedAt: null },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.toAccountId !== undefined ? { toAccountId: input.toAccountId } : {}),
      },
    });
    return tx.transaction.update({
      where: { ledgerId, id: primary.id },
      data: input.categoryId !== undefined ? { categoryId: input.categoryId } : {},
      include: transactionInclude(callerUserId),
    });
  }

  private invalidMergedChange(): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Merged transactions only allow changes to title, category and accounts.',
    );
  }

  private async getLedger(ledgerId: string) {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      select: { kind: true },
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
    tx: Prisma.TransactionClient,
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
      await assertSelectableAccount(tx, input.callerUserId, result.accountId!);
    return result.needsTemporaryAccount
      ? temporaryAccountIdOf(tx, input.payer.userId!)
      : result.accountId;
  }

  private async findActiveForUpdate(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    transactionId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT t."id" FROM "Transaction" t
      WHERE t."ledgerId" = ${ledgerId} AND t."deletedAt" IS NULL
        AND (t."id" = ${transactionId} OR EXISTS (
          SELECT 1 FROM "Transaction" seed
          WHERE seed."id" = ${transactionId} AND seed."ledgerId" = ${ledgerId}
            AND seed."deletedAt" IS NULL AND seed."mergeId" IS NOT NULL
            AND t."mergeId" = seed."mergeId" AND t."mergedFromId" = seed."mergedFromId"
        ))
      ORDER BY t."id"
      FOR UPDATE
    `;
    if (rows.length === 0) throw this.notFound('Transaction');
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
      if (await this.wasMerged(tx, ledgerId, transactionId, callerUserId)) {
        throw this.readOnly(ErrorCode.TRANSACTION_ALREADY_MERGED);
      }
      // 待補端點對 viewer 開放；合併交易須走 editor 的 PATCH，才能同步兩筆內部紀錄。
      if (existing.mergeId) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Change merged accounts through the transaction editor.',
        );
      }
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
      if (
        existing.accountId !== null &&
        existing.accountId !== (await temporaryAccountIdOf(tx, callerUserId))
      ) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.ACCOUNT_NOT_PAYERS,
          'Only a temporary account can be replaced here.',
        );
      }
      await assertSelectableAccount(tx, callerUserId, accountId);
      await tx.transaction.update({ where: { id: transactionId }, data: { accountId } });
    });
    return this.getById(ledgerId, transactionId, callerUserId);
  }

  // ── 借還帳（3b）專用。只給 DebtsModule 呼叫，沒有對應的 HTTP 端點。 ──────────

  /**
   * 在呼叫端的資料庫交易（`client`）裡寫一筆借還交易，回傳它的 id。
   *
   * **帳本權限不在這裡檢查**：呼叫端必須先用 `assertLedgerWritable` 確認呼叫者至少是
   * EDITOR、帳本未封存。這裡沿用一般交易的帳戶規則；借還交易沒有分類。
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
      categoryId?: string;
    },
  ): Promise<string> {
    const accounts = { accountId: input.accountId };
    await this.assertAccountRules(
      input.ledgerId,
      input.creatorId,
      input.type,
      accounts,
      accounts,
      client,
    );

    if (input.categoryId !== undefined) {
      await this.assertDebtCategory(client, input.ledgerId, input.type, input.categoryId);
    }
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
        categoryId: input.categoryId ?? null,
        toAccountId: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * 結清分支繼承還款的帳本、帳戶、建立者與日期，繞過一般收支的分類必填規則：
   * 它不是另一筆使用者選類別的交易，而是還款實收與欠款額之間的差額。
   * `differenceOfId` 有 `@unique`，同一筆還款不會有第二個分支；在呼叫端交易內寫入，
   * 才能與還款紀錄一起提交或回滾。
   */
  async createDebtDifference(
    client: Prisma.TransactionClient,
    repaymentId: string,
    difference: { type: 'EXPENSE' | 'INCOME'; amount: number },
  ): Promise<string> {
    const repayment = await client.transaction.findUniqueOrThrow({ where: { id: repaymentId } });
    const row = await client.transaction.create({
      data: {
        ledgerId: repayment.ledgerId,
        creatorId: repayment.creatorId,
        type: difference.type,
        amount: difference.amount,
        date: repayment.date,
        accountId: repayment.accountId,
        categoryId: null,
        toAccountId: null,
        differenceOfId: repaymentId,
        note: null,
        title: null,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * 免除沖銷往來欠款：免除別人是支出，被免除是收入，沒有金流經過帳戶，也沒有分類。
   * 呼叫端已按寫入者檢查帳本權限；這裡沿用同一個資料庫交易，避免留下孤立的呆帳交易。
   */
  async createDebtForgiveness(
    client: Prisma.TransactionClient,
    input: {
      ledgerId: string;
      creatorId: string;
      type: 'EXPENSE' | 'INCOME';
      amount: number;
      date: Date;
    },
  ): Promise<string> {
    const row = await client.transaction.create({
      data: {
        ...input,
        accountId: null,
        categoryId: null,
        toAccountId: null,
        note: null,
        title: null,
      },
      select: { id: true },
    });
    return row.id;
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
    await this.assertCategoryRules(
      client,
      input.ledgerId,
      input.type ?? 'EXPENSE',
      input.categoryId,
    );

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
    await this.assertCategoryRules(client, input.ledgerId, input.type, input.categoryId);
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

  /** 借還分類只是標記；依後端已決定的借還方向驗證，不影響型別與餘額。 */
  async assertDebtCategory(
    client: Prisma.TransactionClient,
    ledgerId: string,
    kind: TransactionType,
    categoryId: string,
  ): Promise<void> {
    const category = await client.category.findFirst({ where: { id: categoryId, ledgerId } });
    if (category === null) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Category not found.');
    }
    const expected = debtCategoryTypeOf(kind);
    if (expected === null) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'This kind cannot have a debt category.',
      );
    }
    if (category.type !== expected) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CATEGORY_TYPE_MISMATCH,
        "The category's type does not match the debt direction.",
      );
    }
  }

  /** 修改往來交易；換帳戶時分支跟隨，同一個呼叫端資料庫交易內一起提交。 */
  async updateDebtTransaction(
    client: Prisma.TransactionClient,
    transactionId: string,
    input: {
      amount?: number;
      date?: Date;
      title?: string | null;
      accountId?: string;
      categoryId?: string | null;
    },
    callerUserId?: string,
  ): Promise<void> {
    if (input.accountId !== undefined || input.categoryId != null) {
      const existing = await client.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      if (input.accountId !== undefined) {
        // 帳戶一定要以呼叫者的身分檢查，不拿交易的建立者代替：漏傳就是程式錯誤，寧可失敗。
        if (callerUserId === undefined) {
          throw new Error('updateDebtTransaction needs callerUserId to change the account.');
        }
        await assertSelectableAccount(client, callerUserId, input.accountId);
      }
      if (input.categoryId != null) {
        await this.assertDebtCategory(client, existing.ledgerId, existing.type, input.categoryId);
      }
    }
    await client.transaction.update({
      where: { id: transactionId },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      },
    });
    if (input.accountId !== undefined) {
      await client.transaction.updateMany({
        where: { differenceOfId: transactionId, deletedAt: null },
        data: { accountId: input.accountId },
      });
    }
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
   *   - `EXPENSE` / `INCOME`：現有分類與新名稱恰填一個，且須屬同帳本、型別一致；
   *   - `TRANSFER`：不可填——「從銀行領錢到皮夾」不屬於任何消費類別，
   *     若允許帶分類，這筆錢就會出現在支出統計裡，但它其實沒有離開你。
   */
  private async assertCategoryRules(
    client: Prisma.TransactionClient,
    ledgerId: string,
    type: TransactionType,
    categoryId: string | undefined,
    newCategoryName?: string,
  ): Promise<string | null> {
    if (type === 'TRANSFER') {
      if (categoryId !== undefined || newCategoryName !== undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'A transfer cannot have a category.',
        );
      }
      return null;
    }

    if ((categoryId === undefined) === (newCategoryName === undefined)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Exactly one of categoryId or newCategoryName is required for expense and income transactions.',
      );
    }

    if (newCategoryName !== undefined) {
      // IsOptional 會略過 null，service 仍擋下非字串，避免在 trim 時變成 500。
      const name = typeof newCategoryName === 'string' ? newCategoryName.trim() : '';
      const length = Array.from(name).length;
      if (!this.isIncomeExpense(type) || length < 1 || length > CATEGORY_NAME_MAX_LENGTH) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `newCategoryName must be between 1 and ${CATEGORY_NAME_MAX_LENGTH} characters after trimming.`,
        );
      }
      return this.categories.findOrCreateByName(client, ledgerId, type, name);
    }

    const category = await client.category.findUnique({
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
    return category.id;
  }

  /**
   * 所有帳本都計入餘額；一般收支要一個帳戶，轉帳要兩個不同帳戶。
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
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const ledger = await client.ledger.findUnique({
      where: { id: ledgerId },
      select: { id: true },
    });
    if (!ledger) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    // 3h 決策 159、165：所有帳本都計入餘額，每一筆都要有帳戶。
    if (final.accountId === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ACCOUNT_REQUIRED,
        'accountId is required.',
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
        await assertSelectableAccount(client, userId, accountId);
      }
    }
  }

  /** 回傳帳本中某一筆未刪除的交易。 */
  async getById(
    ledgerId: string,
    transactionId: string,
    viewerUserId: string,
  ): Promise<Transaction> {
    const { transaction, context } = await this.loadTransactionView(
      ledgerId,
      transactionId,
      viewerUserId,
    );
    return this.toTransaction(transaction, viewerUserId, context);
  }

  /** 單筆讀取與標註寫入共用載入路徑，避免代表列的選擇各自漂移。 */
  private async loadTransactionView(ledgerId: string, transactionId: string, viewerUserId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
      include: transactionInclude(viewerUserId),
    });
    if (!transaction) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Transaction not found.');
    }
    const context = await this.viewContext(ledgerId, viewerUserId);
    await this.loadRowContext(ledgerId, viewerUserId, [transaction], context);
    return { transaction, context };
  }

  /** 原交易的防重複補帳戶判斷限縮在來源帳本與本人；軟刪除的合併紀錄也仍算合併過。 */
  private async wasMerged(
    client: Prisma.TransactionClient,
    sourceLedgerId: string,
    transactionId: string,
    userId: string,
  ): Promise<boolean> {
    return (
      (await client.transaction.findFirst({
        where: { mergedFromId: transactionId, merge: { sourceLedgerId, userId } },
        select: { id: true },
      })) !== null
    );
  }

  /** 一般 PATCH 也能指定帳戶，不能繞過專用補帳戶端點的防重複限制。 */
  private async assertNotMergedAccountChange(
    client: Prisma.TransactionClient,
    ledgerId: string,
    transactionId: string,
    callerUserId: string,
    input: UpdateTransactionInput,
  ): Promise<void> {
    if (
      (input.accountId !== undefined || input.toAccountId !== undefined) &&
      (await this.wasMerged(client, ledgerId, transactionId, callerUserId))
    ) {
      throw this.readOnly(ErrorCode.TRANSACTION_ALREADY_MERGED);
    }
  }

  /** 批次補上當頁的合併配對、本人合併紀錄與標註代表列，不逐列查詢或改動分頁 id。 */
  private async loadRowContext(
    ledgerId: string,
    viewerUserId: string,
    rows: TransactionRow[],
    context: ViewContext,
  ): Promise<void> {
    const groups = rows
      .filter((row) => row.mergeId && row.mergedFromId)
      .map((row) => ({ mergeId: row.mergeId!, mergedFromId: row.mergedFromId! }));
    context.mergeRows = new Map();
    if (groups.length) {
      const companions = await this.prisma.transaction.findMany({
        where: { ledgerId, deletedAt: null, OR: groups },
        include: transactionInclude(viewerUserId),
      });
      for (const row of companions) {
        const key = this.mergeKey(row);
        const group = context.mergeRows.get(key) ?? [];
        group.push(row);
        context.mergeRows.set(key, group);
      }
    }
    context.mergedOriginalIds = new Set();
    if (rows.length && context.shared) {
      const merged = await this.prisma.transaction.findMany({
        where: {
          mergedFromId: { in: rows.map((row) => row.id) },
          merge: { sourceLedgerId: ledgerId, userId: viewerUserId },
        },
        select: { mergedFromId: true },
      });
      for (const row of merged) {
        if (row.mergedFromId) context.mergedOriginalIds.add(row.mergedFromId);
      }
    }
    await this.loadMarkContext(ledgerId, viewerUserId, rows, context);
  }

  /** 分支跟隨還款；個人分帳僅對擁有者合成。一次取回當頁需要的代表列與標註。 */
  private async loadMarkContext(
    ledgerId: string,
    viewerUserId: string,
    rows: TransactionRow[],
    context: ViewContext,
  ): Promise<void> {
    context.markRows = new Map();
    const parentIds = rows.flatMap((row) => (row.differenceOfId ? [row.differenceOfId] : []));
    const parents = parentIds.length
      ? await this.prisma.transaction.findMany({
          where: { ledgerId, deletedAt: null, id: { in: parentIds } },
          include: transactionInclude(viewerUserId),
        })
      : [];
    const allRows = [...rows, ...parents];
    const splitIds = [
      ...new Set(
        allRows.filter((row) => row.split?.ownerId === viewerUserId).map((row) => row.splitId!),
      ),
    ];
    const splitRows = splitIds.length
      ? await this.prisma.transaction.findMany({
          where: { ledgerId, deletedAt: null, differenceOfId: null, splitId: { in: splitIds } },
          include: transactionInclude(viewerUserId),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    for (const row of allRows) {
      if (row.split?.ownerId !== viewerUserId) continue;
      const group = splitRows.filter((candidate) => candidate.splitId === row.splitId);
      const representative =
        group.find((candidate) => this.isIncomeExpense(candidate.type)) ?? group[0];
      if (representative) context.markRows.set(row.id, representative);
    }
    for (const row of rows) {
      const parent = parents.find((candidate) => candidate.id === row.differenceOfId);
      if (parent) context.markRows.set(row.id, context.markRows.get(parent.id) ?? parent);
    }
  }

  /** PUT、DELETE 與所有交易回應使用同一個代表列，隱藏的分支／代墊不會留下不可見標註。 */
  private markRepresentative(row: TransactionRow, context?: ViewContext): TransactionRow {
    const representative = context?.markRows?.get(row.id) ?? row;
    const group = representative.mergeId
      ? context?.mergeRows?.get(this.mergeKey(representative))
      : undefined;
    const share = group?.find((candidate) => this.isIncomeExpense(candidate.type));
    const advance = group?.find(
      (candidate) =>
        (share?.type === 'EXPENSE' && candidate.type === 'LEND') ||
        (share?.type === 'INCOME' && candidate.type === 'BORROW'),
    );
    return share && advance ? share : representative;
  }

  private mergeKey(row: TransactionRow): string {
    return JSON.stringify([row.mergeId, row.mergedFromId]);
  }

  private async viewContext(ledgerId: string, viewerUserId: string): Promise<ViewContext> {
    const ledger = await this.getLedger(ledgerId);
    const context: ViewContext = {
      shared: ledger.kind === 'SHARED',
      viewerTemporaryAccountId:
        ledger.kind === 'SHARED' ? await temporaryAccountIdOf(this.prisma, viewerUserId) : null,
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
    const group = row.mergeId ? context?.mergeRows?.get(this.mergeKey(row)) : undefined;
    const share = group?.find((item) => this.isIncomeExpense(item.type));
    const advance = group?.find(
      (item) =>
        (share?.type === 'EXPENSE' && item.type === 'LEND') ||
        (share?.type === 'INCOME' && item.type === 'BORROW'),
    );
    // 查代墊 id 也回同一個代表列，讓明細、編輯與列表具有相同的識別與金額。
    if (share && advance) row = share;
    const payer =
      context?.shared && this.isIncomeExpense(row.type) && !row.splitId && !row.debtEntry
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
            viewerTemporaryAccountId: context.viewerTemporaryAccountId,
            payerUserId: settlement.from.userId,
            accountId: row.account?.id ?? null,
            viewerUserId,
          }) ||
          isAccountPending({
            viewerTemporaryAccountId: context.viewerTemporaryAccountId,
            payerUserId: settlement.to.userId,
            accountId: row.toAccount?.id ?? null,
            viewerUserId,
          })
        : payer && context && !row.splitId && !row.debtEntry
          ? isAccountPending({
              viewerTemporaryAccountId: context.viewerTemporaryAccountId,
              payerUserId: payer.userId,
              accountId: row.account?.id ?? null,
              viewerUserId,
            })
          : false;
    return {
      id: row.id,
      type: row.type,
      amount: row.amount + (share && advance ? advance.amount : 0),
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
      // 合併來的、或我已合併過的原交易不再待補（3k 決策 199）；重新加入後沒帳戶的照決策 191 待補。
      accountPending:
        row.mergeId || context?.mergedOriginalIds?.has(row.id)
          ? false
          : accountPending || Boolean(payer?.userId === viewerUserId && !row.account),
      differenceOfId: row.differenceOfId ?? null,
      difference:
        row.difference && row.difference.deletedAt === null
          ? {
              id: row.difference.id,
              type: row.difference.type as 'EXPENSE' | 'INCOME',
              amount: row.difference.amount,
            }
          : null,
      merge:
        row.mergeId && row.merge?.userId === viewerUserId
          ? {
              sourceLedgerName: row.merge.sourceLedgerName,
              share: share && advance ? share.amount : null,
            }
          : null,
      marked:
        this.markRepresentative(row, context).transactionMarks?.some(
          (mark) => mark.userId === viewerUserId,
        ) ?? false,
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
