/**
 * 分類圖示的代號清單（3d，spec `docs/specs/phase-3d-tx-list.md` T2、T3）。
 *
 * 資料庫只存這裡的**代號**，不存圖示庫的元件名稱或 SVG：換圖示庫時只改前端那張
 * 「代號 → 圖示」對照表（`apps/web/src/components/CategoryIcon.tsx`），資料不動。
 * 後端用這份清單驗證輸入，前端用它列出可選的圖示，所以兩邊永遠一致。
 *
 * 新增代號：加在陣列尾端，並在前端對照表補上對應圖示。**不要改名或刪除既有代號**，
 * 資料庫裡可能已經存著它。
 */
export const CATEGORY_ICONS = [
  // 預設分類用的（DEFAULT_CATEGORIES）
  'food',
  'transport',
  'shopping',
  'home',
  'fun',
  'health',
  'education',
  'other',
  'salary',
  'bonus',
  'investment',
  // 其他可選的
  'coffee',
  'travel',
  'pet',
  'gift',
  'clothing',
  'electronics',
  'insurance',
  'tax',
  'utilities',
  'phone',
  'sports',
  'beauty',
  'kids',
  'subscription',
  'fuel',
  'parking',
  'donation',
  'rent',
  'interest',
  'refund',
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** 執行期判斷一個字串是不是合法的圖示代號（前端讀到未知值時退回通用圖示）。 */
export function isCategoryIcon(value: unknown): value is CategoryIcon {
  return typeof value === 'string' && (CATEGORY_ICONS as readonly string[]).includes(value);
}
