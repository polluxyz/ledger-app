import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ListTransactionsQuery,
  Paginated,
  Transaction,
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
 *   - 交易的分類必須屬於同一帳本、且型別一致——新增與更新時都會重新檢查。
 */

// 分頁預設值與每頁筆數上限（客戶端要求超過 MAX_LIMIT 時會被夾住，而非報錯）。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 一筆交易資料列，已 join 其分類與建立者。 */
interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  note: string | null;
  createdAt: Date;
  category: { id: string; name: string };
  creator: { id: string; name: string };
}

// 共用的 Prisma `include`，讓每個讀取都回傳相同的 join 形狀：分類與建立者，
// 各自只取 id + name（絕不回傳整列）。
const TRANSACTION_INCLUDE = {
  category: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

interface CreateTransactionInput {
  type: TransactionType;
  amount: number;
  date: string;
  categoryId: string;
  note?: string;
}

interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  note?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在帳本中記下一筆交易。分類必須屬於同一帳本、且型別與交易一致。
   */
  async create(
    ledgerId: string,
    creatorId: string,
    input: CreateTransactionInput,
  ): Promise<Transaction> {
    await this.assertCategoryConsistent(ledgerId, input.categoryId, input.type);

    const transaction = await this.prisma.transaction.create({
      data: {
        ledgerId,
        creatorId,
        categoryId: input.categoryId,
        type: input.type,
        amount: input.amount,
        date: new Date(input.date),
        note: input.note ?? null,
      },
      include: TRANSACTION_INCLUDE,
    });
    return this.toTransaction(transaction);
  }

  /**
   * 回傳帳本中未刪除交易的其中一頁，新到舊排序，並套用可選的日期區間／分類／
   * 型別篩選。
   */
  async list(ledgerId: string, query: ListTransactionsQuery): Promise<Paginated<Transaction>> {
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

    return { items: rows.map((row) => this.toTransaction(row)), page, limit, total };
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
   * 部分更新一筆交易（共享帳本模型：任何 editor 都可編輯任何一筆）。合併後會重新
   * 驗證 type／category 的組合，確保更新不會讓交易指向型別不符的分類。
   */
  async update(
    ledgerId: string,
    transactionId: string,
    input: UpdateTransactionInput,
  ): Promise<Transaction> {
    const existing = await this.findActive(ledgerId, transactionId);

    // 只有在 type 或 category 可能被改動時，才重新檢查一致性。
    if (input.type !== undefined || input.categoryId !== undefined) {
      const finalType = input.type ?? existing.type;
      const finalCategoryId = input.categoryId ?? existing.categoryId;
      await this.assertCategoryConsistent(ledgerId, finalCategoryId, finalType);
    }

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      include: TRANSACTION_INCLUDE,
    });
    return this.toTransaction(updated);
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

  private async assertCategoryConsistent(
    ledgerId: string,
    categoryId: string,
    type: TransactionType,
  ): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    // 分類不屬於此帳本時回 404（而非 400）：不洩漏它是否存在。
    if (!category || category.ledgerId !== ledgerId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Category not found.');
    }
    if (category.type !== type) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CATEGORY_TYPE_MISMATCH,
        "The category's type does not match the transaction type.",
      );
    }
  }

  /** 回傳帳本中某一筆未刪除的交易。 */
  async getById(ledgerId: string, transactionId: string): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Transaction not found.');
    }
    return this.toTransaction(transaction);
  }

  private toTransaction(row: TransactionRow): Transaction {
    return {
      id: row.id,
      type: row.type,
      amount: row.amount,
      date: row.date.toISOString(),
      note: row.note,
      category: { id: row.category.id, name: row.category.name },
      creator: { id: row.creator.id, name: row.creator.name },
      createdAt: row.createdAt.toISOString(),
    };
  }
}
