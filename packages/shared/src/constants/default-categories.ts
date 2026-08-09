import type { TransactionType } from '../types/transaction';

export interface DefaultCategory {
  name: string;
  type: TransactionType;
}

/**
 * 每個新帳本都會複製一份的預設分類。它們被視為「使用者資料」（可改名、可刪除），
 * 而非固定的系統值——如此便為未來的 i18n 與各帳本自訂保留了彈性。
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: '餐飲', type: 'EXPENSE' },
  { name: '交通', type: 'EXPENSE' },
  { name: '購物', type: 'EXPENSE' },
  { name: '居住', type: 'EXPENSE' },
  { name: '娛樂', type: 'EXPENSE' },
  { name: '醫療', type: 'EXPENSE' },
  { name: '教育', type: 'EXPENSE' },
  { name: '其他', type: 'EXPENSE' },
  { name: '薪資', type: 'INCOME' },
  { name: '獎金', type: 'INCOME' },
  { name: '投資', type: 'INCOME' },
  { name: '其他', type: 'INCOME' },
] as const;
