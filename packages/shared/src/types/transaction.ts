/**
 * Whether a transaction (and the category it belongs to) records money going
 * out or coming in. Mirrors the Prisma `TransactionType` enum by value, kept
 * here so the frontend can share it without importing backend-generated code.
 * Declared as a const tuple so the values can be reused for runtime validation.
 */
export const TRANSACTION_TYPES = ['EXPENSE', 'INCOME'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** A transaction as returned by the API. */
export interface Transaction {
  id: string;
  type: TransactionType;
  /** Amount in the ledger currency's minor unit; always a positive integer. */
  amount: number;
  /** ISO 8601 timestamp of when the money moved. */
  date: string;
  note: string | null;
  category: { id: string; name: string };
  /** Who recorded it (display/audit only; any editor may edit any entry). */
  creator: { id: string; name: string };
  /** ISO 8601 timestamp of when the row was created. */
  createdAt: string;
}

/** Body of POST /ledgers/{ledgerId}/transactions. */
export interface CreateTransactionRequest {
  type: TransactionType;
  amount: number;
  date: string;
  categoryId: string;
  note?: string;
}

/**
 * Body of PATCH /ledgers/{ledgerId}/transactions/{transactionId}.
 * All fields optional; only the supplied ones are updated. The resulting
 * type and category must still be consistent.
 */
export interface UpdateTransactionRequest {
  type?: TransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  note?: string;
}

/** Query parameters for GET /ledgers/{ledgerId}/transactions. */
export interface ListTransactionsQuery {
  /** 1-based page number (default 1). */
  page?: number;
  /** Page size (default 20, capped at 100). */
  limit?: number;
  /** Inclusive lower bound on the transaction date (ISO 8601). */
  from?: string;
  /** Inclusive upper bound on the transaction date (ISO 8601). */
  to?: string;
  categoryId?: string;
  type?: TransactionType;
}
