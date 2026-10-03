import type { CategoryType } from '../types/transaction';
import type { CategoryIcon } from './category-icons';

export interface DefaultCategory {
  name: string;
  type: CategoryType;
  /** 預設圖示（3d T4）。既有帳本的同名預設分類由 migration 依這份對照回填。 */
  icon: CategoryIcon;
}

/**
 * 每個新帳本都會複製一份的預設分類。它們被視為「使用者資料」（可改名、可刪除），
 * 而非固定的系統值——如此便為未來的 i18n 與各帳本自訂保留了彈性。
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: '餐飲', type: 'EXPENSE', icon: 'food' },
  { name: '交通', type: 'EXPENSE', icon: 'transport' },
  { name: '購物', type: 'EXPENSE', icon: 'shopping' },
  { name: '居住', type: 'EXPENSE', icon: 'home' },
  { name: '娛樂', type: 'EXPENSE', icon: 'fun' },
  { name: '醫療', type: 'EXPENSE', icon: 'health' },
  { name: '教育', type: 'EXPENSE', icon: 'education' },
  { name: '其他', type: 'EXPENSE', icon: 'other' },
  { name: '薪資', type: 'INCOME', icon: 'salary' },
  { name: '獎金', type: 'INCOME', icon: 'bonus' },
  { name: '投資', type: 'INCOME', icon: 'investment' },
  { name: '其他', type: 'INCOME', icon: 'other' },
] as const;
