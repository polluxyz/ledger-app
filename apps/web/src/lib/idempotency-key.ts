/**
 * 產生 R1 防重複送出的鍵，讓後端辨認同一次記帳的重試。
 * 手動表單用 state 保留鍵，成功後換鍵；AI 每筆草稿各有一把鍵，新草稿產生新鍵。
 * 失敗後即使修改內容也保留原鍵（W289～W290），避免重試時多記一筆。
 * 用 getRandomValues 組 UUID v4，因為 HTTP 區網 IP 等非安全環境沒有 crypto.randomUUID。
 */
export function createIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
