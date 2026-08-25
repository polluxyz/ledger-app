import type { ListTransactionsQuery, TransactionType } from '@ledger/shared';

/**
 * 篩選列的畫面狀態。
 *
 * 每個欄位都是字串，因為 `<select>` 與 `<input type="date">` 給的就是字串，
 * 而「沒有選」就是空字串。轉成 API 要的形狀是 `toListQuery` 的事。
 */
export interface TransactionFilters {
  /** 空字串＝全部型別。 */
  type: TransactionType | '';
  /** 空字串＝全部分類。 */
  categoryId: string;
  /** `YYYY-MM-DD`，來自 `<input type="date">`。 */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  type: '',
  categoryId: '',
  from: '',
  to: '',
};

/** 有沒有任何條件被選起來（決定要不要顯示「清除篩選」）。 */
export function hasAnyFilter(filters: TransactionFilters): boolean {
  return Object.values(filters).some((value) => value !== '');
}

/**
 * 把畫面狀態轉成後端的查詢參數。
 *
 * 日期兩端刻意不對稱：`from` 取當天開始、`to` 取當天結束。後端是
 * `date >= from` 與 `date <= to`，若把 `to` 直接送成當天 00:00，
 * 「篩到 8/25」會漏掉 8/25 當天記的每一筆——使用者只會覺得資料不見了。
 *
 * 用本地時間解讀（`2026-08-25T00:00:00` 沒有時區後綴＝本地），與列表顯示日期的
 * 方式一致；跨時區的正確性由後端與儲存的 ISO 時間戳負責。
 */
export function toListQuery(filters: TransactionFilters, page: number): ListTransactionsQuery {
  return {
    page,
    ...(filters.type === '' ? {} : { type: filters.type }),
    ...(filters.categoryId === '' ? {} : { categoryId: filters.categoryId }),
    ...(filters.from === '' ? {} : { from: new Date(`${filters.from}T00:00:00`).toISOString() }),
    ...(filters.to === '' ? {} : { to: new Date(`${filters.to}T23:59:59.999`).toISOString() }),
  };
}
