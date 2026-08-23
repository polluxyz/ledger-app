import { useContext } from 'react';
import { ActiveLedgerContext, type ActiveLedgerContextValue } from './active-ledger-context';

/**
 * 取用作用中帳本。在 Provider 之外呼叫會直接拋錯——與其回傳 undefined 讓錯誤在
 * 遠處以難懂的形式炸開，不如在源頭講清楚。比照 `useAuth`。
 */
export function useActiveLedger(): ActiveLedgerContextValue {
  const context = useContext(ActiveLedgerContext);
  if (!context) {
    throw new Error('useActiveLedger 必須在 <ActiveLedgerProvider> 內使用。');
  }
  return context;
}
