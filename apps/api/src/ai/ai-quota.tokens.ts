/**
 * AI 記帳額度的注入點（4a 額度決策 292、295）。
 *
 * 上限與時鐘都做成可注入的 token，測試才能用 `overrideProvider` 換成小的上限與固定時間。
 * 實作每次呼叫都要重新讀 `AI_QUOTA_LIMITS` 的欄位，不可在建構時快取：
 * e2e 會在同一個 app 裡改這個物件的值。
 */

/** 3 個上限，來自環境變數 `AI_PARSE_DAILY_LIMIT_PER_USER` 等（決策 292 (a)～(c)）。0＝停用。 */
export interface AiQuotaLimits {
  perUserDaily: number;
  globalDaily: number;
  maxOutputTokens: number;
}

export const AI_QUOTA_LIMITS = Symbol('AI_QUOTA_LIMITS');

/** 取得現在時間。用來算台灣時間的日曆日（決策 295）。 */
export type AiClock = () => Date;

export const AI_CLOCK = Symbol('AI_CLOCK');
