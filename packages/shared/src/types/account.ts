import type { Cents } from '../money';

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
   * 開始使用本系統時，這個帳戶已經有的金額。單位：分。
   * **可為負**——例如信用卡在導入前就已經有的欠款。
   */
  initialBalance: Cents;
  /**
   * 目前餘額，單位：分。由後端**即時計算**（初始餘額 ± 各筆交易），**不是儲存欄位**。
   *
   * 之所以不存起來：只要有任何一條路徑忘了更新它，數字就會永久失準，而且
   * 從外面完全看不出來；算出來的則不可能失準。
   *
   * 計算時排除軟刪除的交易。3h 起所有帳本的交易都算進來（決策 165）。
   */
  balance: Cents;
  /**
   * 臨時帳戶（3h 決策 167～169）：每個使用者剛好一個，算進總資產。共享帳本裡別人替我記、
   * 選不到我的帳戶時，金額先記在這裡，之後由我本人換到真正的帳戶。
   *
   * 不能在任何表單裡手動選（送進來回 400 `TEMPORARY_ACCOUNT_NOT_SELECTABLE`），也不能改名
   * 或刪除（409 `TEMPORARY_ACCOUNT_LOCKED`）。帳戶頁只在它裡面有交易時才顯示（W174）。
   */
  isTemporary: boolean;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** POST /accounts 的請求 body。 */
export interface CreateAccountRequest {
  name: string;
  /** 單位：分；省略時視為 0，可為負數。 */
  initialBalance?: Cents;
}

/**
 * PATCH /accounts/{accountId} 的請求 body。**只能改名**。
 *
 * 改名不影響歷史交易，因為交易存的是 id，不是名稱快照。
 *
 * `initialBalance` 刻意不在這裡：它是「開始使用本系統那一刻」的歷史事實，不是設定值。
 * 開放事後修改，等於讓一個數字無聲地改變所有歷史餘額。填錯的補救方式是刪掉帳戶重建
 * （沒有交易引用時後端允許）；已經有交易的帳戶則要等「批量修改交易的帳戶」功能。
 */
export interface UpdateAccountRequest {
  name?: string;
}

/**
 * `GET /users/me/record-defaults` 的回應（3h 決策 174、W177）：記帳表單預設帶入的帳本與帳戶。
 *
 * 跟著帳號走：由後端查「我建立、帳戶是我的真正帳戶（不是臨時帳戶）」的最近一筆交易。
 * `ledgerId` 只回我還能寫入的帳本（EDITOR 以上、未封存、沒退出），不符合就是 `null`；
 * 從沒記過帳時兩個都是 `null`。
 */
export interface RecordDefaults {
  ledgerId: string | null;
  accountId: string | null;
}

/** `GET /users/me/record-defaults` 的查詢參數。 */
export interface RecordDefaultsQuery {
  /**
   * 帳本已由頁面決定的表單用（W177）：回我在這本帳本最近用的帳戶，沒用過才回整體最近一次；
   * `ledgerId` 照原值回傳。我沒權限的帳本回 404。
   */
  ledgerId?: string;
}
