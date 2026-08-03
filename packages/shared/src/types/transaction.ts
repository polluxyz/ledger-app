/**
 * Whether a transaction (and the category it belongs to) records money going
 * out or coming in. Mirrors the Prisma `TransactionType` enum by value, kept
 * here so the frontend can share it without importing backend-generated code.
 */
export type TransactionType = 'EXPENSE' | 'INCOME';
