/**
 * Whether a transaction (and the category it belongs to) records money going
 * out or coming in. Mirrors the Prisma `TransactionType` enum by value, kept
 * here so the frontend can share it without importing backend-generated code.
 * Declared as a const tuple so the values can be reused for runtime validation.
 */
export const TRANSACTION_TYPES = ['EXPENSE', 'INCOME'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
