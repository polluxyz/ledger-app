import type { CategoryIcon } from '../constants/category-icons';
import type { CategoryType } from './transaction';

/** API 回傳的分類形狀。 */
export interface Category {
  id: string;
  name: string;
  /** 只會是 `EXPENSE` 或 `INCOME`——轉帳不使用分類。 */
  type: CategoryType;
  /**
   * 顯示順序。**前端不需要拿它來排序**——列表端點已經照它排好，照回傳順序渲染即可。
   *
   * 它出現在這裡只是讓契約誠實：後端回應裡有這個欄位，型別就該寫出來。
   * 前端自己再排一次等於把排序規則複製到第二個地方，兩邊遲早分岔。
   */
  sortOrder: number;
  /**
   * 圖示代號（3d），合法值見 `CATEGORY_ICONS`。`null` 顯示通用圖示。
   * 前端遇到清單外的值（例如舊版前端讀到新代號）也退回通用圖示。
   */
  icon: CategoryIcon | null;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** POST /ledgers/{ledgerId}/categories 的請求 body。 */
export interface CreateCategoryRequest {
  name: string;
  type: CategoryType;
  /** 省略或 `null`＝通用圖示；不在 `CATEGORY_ICONS` 裡回 400。 */
  icon?: CategoryIcon | null;
}

/**
 * PATCH /ledgers/{ledgerId}/categories/{categoryId} 的請求 body。
 * 可以改名稱與圖示；變更型別會破壞既有交易的型別一致性，因此要「換型別」等同於
 * 刪除後重建。只有送出的欄位會變；`icon: null` 清除圖示。
 */
export interface UpdateCategoryRequest {
  name?: string;
  icon?: CategoryIcon | null;
}
