import type { TransactionType } from './transaction';

/** API 回傳的分類形狀。 */
export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** POST /ledgers/{ledgerId}/categories 的請求 body。 */
export interface CreateCategoryRequest {
  name: string;
  type: TransactionType;
}

/**
 * PATCH /ledgers/{ledgerId}/categories/{categoryId} 的請求 body。
 * 只有名稱可改；變更型別會破壞既有交易的型別一致性，因此要「換型別」等同於
 * 刪除後重建。
 */
export interface UpdateCategoryRequest {
  name: string;
}
