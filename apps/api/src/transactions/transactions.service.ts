import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ListTransactionsQuery,
  Paginated,
  Transaction,
  TransactionRef,
  TransactionType,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
 *   - 帳戶屬於使用者（不是帳本），因此永遠只接受**呼叫者本人**的帳戶，
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
  createdAt: Date;
  category: { id: string; name: string } | null;
  account: AccountRef | null;
  toAccount: AccountRef | null;
  creator: { id: string; name: string };
}

// 共用的 Prisma `include`，讓每個讀取都回傳相同的 join 形狀。帳戶多選一個
// `userId`——遮蔽他人帳戶時需要它來比對檢視者，其他欄位一概不取。
const TRANSACTION_INCLUDE = {
  category: { select: { id: true, name: true } },
  account: { select: { id: true, name: true, userId: true } },
  toAccount: { select: { id: true, name: true, userId: true } },
  creator: { select: { id: true, name: true } },
} as const;

interface CreateTransactionInput {
  type: TransactionType;
  amount: number;
  date: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  note?: string;
}

interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  note?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在帳本中記下一筆交易。分類與帳戶各自的必填與否，取決於交易型別與帳本設定；
   * 完整規則見 `assertAccountRules`。
   */
  async create(
    ledgerId: string,
    creatorId: string,
    input: CreateTransactionInput,
  ): Promise<Transaction> {
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

    const where: Prisma.TransactionWhereInput = {
      ledgerId,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...this.dateRange(query.from, query.to),
    };

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        // 穩定排序：先依日期，再用建立時間打破同一天的並列。
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toTransaction(row, viewerUserId)),
      page,
      limit,
      total,
    };
  }

  private dateRange(from?: string, to?: string): Prisma.TransactionWhereInput {
    if (!from && !to) {
      return {};
    }
    return {
      date: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
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
    const existing = await this.findActive(ledgerId, transactionId);

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

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        categoryId: finalCategoryId ?? null,
        accountId: finalAccountId ?? null,
        toAccountId: finalToAccountId ?? null,
      },
      include: TRANSACTION_INCLUDE,
    });
    return this.toTransaction(updated, viewerUserId);
  }

  /** 軟刪除一筆交易（設 deletedAt）；資料列保留以利稽核。 */
  async remove(ledgerId: string, transactionId: string): Promise<void> {
    await this.findActive(ledgerId, transactionId);
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * 載入帳本中某筆未刪除的交易，找不到就丟 404。由 update／remove 共用，讓
   * 「不存在」「已軟刪除」「屬於別的帳本」這三種 id 一律同樣不可見。
   */
  private async findActive(ledgerId: string, transactionId: string) {
    const existing = await this.prisma.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
    });
    if (!existing) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Transaction not found.');
    }
    return existing;
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
    return this.toTransaction(transaction, viewerUserId);
  }

  /**
   * 把資料列轉成對外的交易形狀。
   *
   * `viewerUserId` **刻意沒有預設值**：帳戶欄位要不要遮蔽，取決於「誰在看」。
   * 若給了預設值，日後有人新增讀取路徑卻忘了傳，程式仍能編譯，而遮蔽會靜悄悄
   * 失效、洩漏他人的帳戶名稱。沒有預設值，型別系統就會強迫每個呼叫點交代清楚。
   */
  private toTransaction(row: TransactionRow, viewerUserId: string): Transaction {
    return {
      id: row.id,
      type: row.type,
      amount: row.amount,
      date: row.date.toISOString(),
      note: row.note,
      category: row.category ? { id: row.category.id, name: row.category.name } : null,
      account: this.visibleAccount(row.account, viewerUserId),
      toAccount: this.visibleAccount(row.toAccount, viewerUserId),
      creator: { id: row.creator.id, name: row.creator.name },
      createdAt: row.createdAt.toISOString(),
    };
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
