import type { TransactionType } from '../types/transaction';

export interface DefaultCategory {
  name: string;
  type: TransactionType;
}

/**
 * Seed categories copied into every new ledger. They are treated as user data
 * (renameable, deletable) rather than fixed system values, which keeps the door
 * open for future i18n and per-ledger customisation.
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
