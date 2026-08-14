/**
 * 帳戶——錢實際放在哪裡（現金、某家銀行、某張信用卡）。
 *
 * 帳戶屬於**使用者**而非帳本：同一張信用卡若綁在帳本上，在多本帳本就得各建一次、
 * 餘額各算各的，那必定是錯的。因此帳戶跨帳本共用，端點也放在頂層 `/accounts`
 * 而不在 `/ledgers/{id}` 之下。
 */
export interface Account {
  id: string;
  name: string;
  /**
   * 開始使用本系統時，這個帳戶已經有的金額。
   * **可為負**——例如信用卡在導入前就已經有的欠款。
   */
  initialBalance: number;
  /**
   * 目前餘額。由後端**即時計算**（初始餘額 ± 各筆交易），**不是儲存欄位**。
   *
   * 之所以不存起來：只要有任何一條路徑忘了更新它，數字就會永久失準，而且
   * 從外面完全看不出來；算出來的則不可能失準。
   *
   * 計算時排除軟刪除的交易，也排除「不與帳戶連動」的帳本（`tracksBalance: false`）。
   */
  balance: number;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** POST /accounts 的請求 body。 */
export interface CreateAccountRequest {
  name: string;
  /** 省略時視為 0；可為負數。 */
  initialBalance?: number;
}

/**
 * PATCH /accounts/{accountId} 的請求 body。兩個欄位都可單獨更新。
 *
 * 改 `initialBalance` 會連帶讓餘額整體平移——這正是使用者「一開始填錯、事後校正」
 * 時想要的行為。改名則不影響歷史交易（交易存的是 id，不是名稱快照）。
 */
export interface UpdateAccountRequest {
  name?: string;
  initialBalance?: number;
}
