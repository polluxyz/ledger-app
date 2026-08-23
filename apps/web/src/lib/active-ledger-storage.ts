/**
 * 「作用中帳本」的 id 保存位置。
 *
 * 這裡存的只是一個偏好設定——使用者上次在哪一本帳本記帳。它**不是**權限依據：
 * 這個 id 能不能用，一律由 `/ledgers` 回來的清單決定（後端只會回傳他有權存取的
 * 帳本）。所以即使有人手動改掉這個值，也只會被退回第一本帳本，拿不到別人的資料。
 *
 * 所有存取集中在這個模組，比照 `token-storage.ts`。
 */
const ACTIVE_LEDGER_KEY = 'ledger.activeLedgerId';

export function readActiveLedgerId(): string | null {
  return localStorage.getItem(ACTIVE_LEDGER_KEY);
}

export function writeActiveLedgerId(ledgerId: string): void {
  localStorage.setItem(ACTIVE_LEDGER_KEY, ledgerId);
}

export function clearActiveLedgerId(): void {
  localStorage.removeItem(ACTIVE_LEDGER_KEY);
}
