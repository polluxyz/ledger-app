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

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** A transaction row joined with its category and creator. */
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
   * Records a transaction in the ledger. The category must belong to the same
   * ledger and match the transaction's type.
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
   * Returns a page of the ledger's non-deleted transactions, newest first,
   * filtered by the optional date range / category / type.
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
        // Stable order: by date, then creation time to break same-day ties.
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
   * Partially updates a transaction (shared-ledger model: any editor may edit
   * any entry). The resulting type/category pair is re-validated so an update
   * can never leave a transaction pointing at a mismatched category.
   */
  async update(
    ledgerId: string,
    transactionId: string,
    input: UpdateTransactionInput,
  ): Promise<Transaction> {
    const existing = await this.findActive(ledgerId, transactionId);

    // Only re-check consistency when type or category could have changed.
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

  /** Soft-deletes a transaction (sets deletedAt); the row is kept for audit. */
  async remove(ledgerId: string, transactionId: string): Promise<void> {
    await this.findActive(ledgerId, transactionId);
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Loads a non-deleted transaction in the ledger or throws 404. Shared by
   * update/remove so a missing, soft-deleted, or cross-ledger id is uniformly
   * invisible.
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
    // 404 (not 400) for a category outside this ledger: do not leak its existence.
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

  /** Returns one non-deleted transaction that belongs to the ledger. */
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
