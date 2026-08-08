import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, Transaction, TransactionType } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

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
    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
    });
    // 404 (not 400) for a category outside this ledger: do not leak its existence.
    if (!category || category.ledgerId !== ledgerId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Category not found.');
    }
    if (category.type !== input.type) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CATEGORY_TYPE_MISMATCH,
        "The category's type does not match the transaction type.",
      );
    }

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
