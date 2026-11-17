/**
 * 防重複送出（R1）的 header 契約，前後端共用同一個名稱。
 *
 * 建立金錢紀錄的 5 個端點必須帶這個 header，值是前端產生的 UUID（R1 決策 361、363）。
 * 同一個使用者用同一把鍵重送時，後端回第 1 次建立的那筆，不會多記一筆。
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
