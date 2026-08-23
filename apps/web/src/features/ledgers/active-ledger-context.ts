import { createContext } from 'react';
import type { LedgerSummary } from '@ledger/shared';

/**
 * 目前作用中的帳本——也就是首頁記帳時會寫進哪一本。
 *
 * Context 與 Provider 元件分檔，是為了讓每個檔案只匯出單一種東西
 * （react-refresh 的 lint 規則要求，這樣 HMR 才能正確運作）。
 */
export interface ActiveLedgerContextValue {
  /** 作用中的帳本；尚未載入或一本都沒有時為 null。 */
  ledger: LedgerSummary | null;
  /** 使用者可切換的帳本（**不含已封存的**）。 */
  ledgers: LedgerSummary[];
  /** 切換作用中帳本。傳入的 id 必須來自 `ledgers`。 */
  setActiveLedgerId: (ledgerId: string) => void;
  isLoading: boolean;
  error: Error | null;
}

export const ActiveLedgerContext = createContext<ActiveLedgerContextValue | null>(null);
