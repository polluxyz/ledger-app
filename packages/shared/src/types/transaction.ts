/**
 * 一筆交易的型別：支出、收入、轉帳，以及借還帳的 4 種（見 `DEBT_TRANSACTION_TYPES`）。
 * 與 Prisma 的 `TransactionType` enum 值
 * 對應，放在這裡是為了讓前端也能共用，而不必 import 後端產生的程式碼。宣告成
 * const tuple，好讓這組值也能重用於執行期驗證。
 *
 * `TRANSFER` 是帳戶之間的資金移動（例如從銀行領現金），**不計入收入也不計入支出**
 * ——錢只是換了地方，總額沒變。做成獨立型別而非「兩筆連動交易」，是因為一筆就是
 * 一件事，不會產生孤兒或金額不一致，統計時也不必記得排除。
 */
export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'LEND',
  'BORROW',
  'COLLECT',
  'REPAY',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * 使用者可以在 `/ledgers/{id}/transactions` 直接建立或改成的型別。
 *
 * 借還的 4 種型別刻意不在這裡：它們只能從債務端點產生（見 `DEBT_TRANSACTION_TYPES`），
 * 否則交易金額會與債務的本金、還款對不起來。
 */
export const MANUAL_TRANSACTION_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;
export type ManualTransactionType = (typeof MANUAL_TRANSACTION_TYPES)[number];

/**
 * 借還帳（階段三 3b）產生的交易型別。資金方向固定，**不算收入也不算支出**：
 *
 * - `LEND` 借出、`REPAY` 償還：錢從帳戶出去。
 * - `BORROW` 借入、`COLLECT` 收回：錢進到帳戶。
 *
 * 使用者不會自己挑這 4 種：建立債務時說「我借出／我借入」，記還款時由系統依角色決定
 * `COLLECT` 或 `REPAY`。這類交易在一般交易端點是唯讀的。
 */
export const DEBT_TRANSACTION_TYPES = ['LEND', 'BORROW', 'COLLECT', 'REPAY'] as const;
export type DebtTransactionType = (typeof DEBT_TRANSACTION_TYPES)[number];

/** 這筆交易是不是借還帳產生的（在一般交易端點唯讀）。 */
export function isDebtTransactionType(type: TransactionType): type is DebtTransactionType {
  return (DEBT_TRANSACTION_TYPES as readonly TransactionType[]).includes(type);
}

/**
 * 分類可以掛的型別。分類只服務於支出與收入——轉帳沒有分類（「從銀行領錢」不屬於
 * 任何消費類別），所以這裡刻意比 `TransactionType` 窄。
 */
export const CATEGORY_TYPES = ['EXPENSE', 'INCOME'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** 交易回應中，被引用資源的精簡形狀（只有顯示所需的 id 與名稱）。 */
export interface TransactionRef {
  id: string;
  name: string;
}

/** API 回傳的交易形狀。 */
export interface Transaction {
  id: string;
  type: TransactionType;
  /** 以帳本幣別最小單位表示的金額；恆為正整數。TWD 的最小單位即為「元」。 */
  amount: number;
  /** 這筆錢發生的時間（ISO 8601）。 */
  date: string;
  note: string | null;
  /** 分類；`TRANSFER` 交易為 `null`。 */
  category: TransactionRef | null;
  /**
   * 錢從哪個帳戶出去（`INCOME` 則是進到哪個帳戶）。以下兩種情況為 `null`：
   *
   * 1. 這筆交易屬於「不與帳戶連動」的帳本（`tracksBalance: false`）；
   * 2. 該帳戶**不屬於目前的檢視者**——共享帳本中，成員看得到彼此的金額與分類，
   *    但看不到對方從哪個戶頭付的（帳戶名稱可能敏感，且協作並不需要這項資訊）。
   */
  account: TransactionRef | null;
  /** 轉入的帳戶；僅 `TRANSFER` 有值，且同樣套用上述隱私規則。 */
  toAccount: TransactionRef | null;
  /** 由誰記下（僅供顯示／稽核；共享帳本下任何 editor 都可編輯任何一筆）。 */
  creator: TransactionRef;
  /**
   * 借還交易所屬的債務 id。**只有債務擁有者看得到**：共享帳本的其他成員看得到這筆
   * 交易，但看不到背後的債務，對他們一律是 `null`。一般交易也是 `null`。
   */
  debtId: string | null;
  /** 這筆資料列被建立的時間（ISO 8601）。 */
  createdAt: string;
}

/**
 * POST /ledgers/{ledgerId}/transactions 的請求 body。
 *
 * `categoryId` 與 `accountId` 在型別上都是選填，但實際上是**條件必填**——該不該填
 * 取決於交易型別與帳本設定，TypeScript 表達不了這種依賴，因此由後端 service 把關。
 * 規則如下（違反時回 400）：
 *
 * | 情境                     | `accountId`  | `categoryId` | `toAccountId` |
 * | ------------------------ | ------------ | ------------ | ------------- |
 * | 連動帳本 ＋ 支出／收入   | **必填**     | **必填**     | 不可填        |
 * | 連動帳本 ＋ 轉帳         | **必填**     | **不可填**   | **必填**      |
 * | 非連動帳本 ＋ 支出／收入 | **不可填**   | **必填**     | 不可填        |
 * | 非連動帳本 ＋ 轉帳       | 不適用（非連動帳本不影響餘額，轉帳沒有意義）        |
 *
 * 「連動帳本」指 `tracksBalance: true` 的帳本（預設）。
 */
export interface CreateTransactionRequest {
  type: ManualTransactionType;
  amount: number;
  date: string;
  /** 支出／收入必填；轉帳不可填。須屬於同一帳本、且型別一致。 */
  categoryId?: string;
  /** 連動帳本必填、非連動帳本不可填。須屬於**呼叫者本人**（否則 404）。 */
  accountId?: string;
  /** 僅轉帳使用：轉入的帳戶。須屬於本人，且不得與 `accountId` 相同。 */
  toAccountId?: string;
  note?: string;
}

/**
 * PATCH /ledgers/{ledgerId}/transactions/{transactionId} 的請求 body。
 * 所有欄位皆可選，只有送出的欄位會被更新；合併後仍須滿足上表的條件必填規則。
 */
export interface UpdateTransactionRequest {
  type?: ManualTransactionType;
  amount?: number;
  date?: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
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
