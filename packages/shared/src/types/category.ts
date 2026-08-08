import type { TransactionType } from './transaction';

/** A category as returned by the API. */
export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Body of POST /ledgers/{ledgerId}/categories. */
export interface CreateCategoryRequest {
  name: string;
  type: TransactionType;
}

/**
 * Body of PATCH /ledgers/{ledgerId}/categories/{categoryId}.
 * Only the name is editable; changing type would break the type consistency
 * of existing transactions, so a retype means delete + recreate.
 */
export interface UpdateCategoryRequest {
  name: string;
}
