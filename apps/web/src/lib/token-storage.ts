/**
 * JWT 的保存位置。
 *
 * ⚠️ 安全取捨（spec §2 假設 6）：MVP 階段存在 `localStorage`，好處是實作最簡單、
 * 重整頁面不會掉登入。代價是若網站出現 XSS，惡意腳本讀得到這個 token。
 * 正式化時應改為由後端簽發 httpOnly cookie（腳本讀不到），但那需要後端配合
 * 處理 CSRF 與跨網域，屬未來工作。
 *
 * 所有存取都集中在這個模組，屆時只需改這裡。
 */
const TOKEN_KEY = 'ledger.accessToken';
const TOKEN_EXPIRED_EVENT = 'ledger:token-expired';

export function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function writeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 只讓目前的憑證失效，避免舊請求的回應登出新登入的使用者。 */
export function invalidateToken(token: string): void {
  if (readToken() !== token) return;
  clearToken();
  window.dispatchEvent(new Event(TOKEN_EXPIRED_EVENT));
}

export function onTokenExpired(callback: () => void): () => void {
  window.addEventListener(TOKEN_EXPIRED_EVENT, callback);
  return () => window.removeEventListener(TOKEN_EXPIRED_EVENT, callback);
}
