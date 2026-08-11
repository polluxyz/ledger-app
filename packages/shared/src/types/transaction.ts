/**
 * 一筆交易（以及它所屬的分類）是「支出」還是「收入」。與 Prisma 的
 * `TransactionType` enum 值對應，放在這裡是為了讓前端也能共用，而不必 import
 * 後端產生的程式碼。宣告成 const tuple，好讓這組值也能重用於執行期驗證。
 */
export const TRANSACTION_TYPES = ['EXPENSE', 'INCOME'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** API 回傳的交易形狀。 */
export interface Transaction {
  id: string;
  type: TransactionType;
  /** 以帳本幣別最小單位表示的金額；恆為正整數。 */
  amount: number;
  /** 這筆錢發生的時間（ISO 8601）。 */
  date: string;
  note: string | null;
  category: { id: string; name: string };
  /** 付款方式（選填）；未指定時為 null。 */
  paymentMethod: { id: string; name: string } | null;
  /** 由誰記下（僅供顯示／稽核；共享帳本下任何 editor 都可編輯任何一筆）。 */
  creator: { id: string; name: string };
  /** 這筆資料列被建立的時間（ISO 8601）。 */
  createdAt: string;
}

/** POST /ledgers/{ledgerId}/transactions 的請求 body。 */
export interface CreateTransactionRequest {
  type: TransactionType;
  amount: number;
  date: string;
  categoryId: string;
  /** 付款方式 id（選填）；須屬同一帳本。 */
  paymentMethodId?: string;
  note?: string;
}

/**
 * PATCH /ledgers/{ledgerId}/transactions/{transactionId} 的請求 body。
 * 所有欄位皆可選，只有送出的欄位會被更新。更新後 type 與 category 仍須一致。
 */
export interface UpdateTransactionRequest {
  type?: TransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  paymentMethodId?: string;
  note?: string;
}

/** GET /ledgers/{ledgerId}/transactions 的查詢參數。 */
export interface ListTransactionsQuery {
  /** 以 1 為起始的頁碼（預設 1）。 */
  page?: number;
  /** 每頁筆數（預設 20，上限 100）。 */
  limit?: number;
  /** 交易日期的下界，包含此值（ISO 8601）。 */
  from?: string;
  /** 交易日期的上界，包含此值（ISO 8601）。 */
  to?: string;
  categoryId?: string;
  type?: TransactionType;
}
