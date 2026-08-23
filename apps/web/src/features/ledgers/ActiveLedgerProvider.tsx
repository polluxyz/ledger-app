import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/use-auth';
import { readActiveLedgerId, writeActiveLedgerId } from '../../lib/active-ledger-storage';
import { ActiveLedgerContext, type ActiveLedgerContextValue } from './active-ledger-context';
import { useLedgers } from './use-ledgers';

/**
 * 提供「作用中帳本」給整棵元件樹。
 *
 * ## 存下來的 id 一定要驗證
 *
 * `localStorage` 裡的 id 隨時可能失效：帳本被刪、我被移出成員、帳本被封存。
 * 因此它只是一個**候選值**，要與 `/ledgers` 回來的清單對照過才採用；對不上就
 * 退回第一本。
 *
 * 這裡取的是未封存的清單，所以「已封存」會自然落進「對不上」的分支，不必另外判斷。
 *
 * 少了這道驗證，症狀是首頁一直空白，而使用者完全看不出原因——畫面上沒有任何東西
 * 顯示「你正指著一本已經不存在的帳本」。
 *
 * ## 為什麼作用中帳本是「算出來的」而不是另一份 state
 *
 * 候選 id 與清單各自會變，真正生效的帳本一律由這兩者當場算出。若改成用 effect
 * 把算出來的結果寫回 state，就會多一輪渲染，而且兩份資料之間會出現短暫的不一致。
 * localStorage 是外部系統，才用 effect 同步。
 */
export function ActiveLedgerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  // Provider 掛在路由之上，不能像 AccountBalances 那樣「未登入就不渲染」。
  // hook 也不能有條件呼叫，所以改由 enabled 擋掉那個註定 401 的請求。
  const { data, isLoading, error } = useLedgers(false, isAuthenticated);
  const ledgers = useMemo(() => data ?? [], [data]);

  // 使用者上次選的帳本。它只是候選值，未必是最後生效的那一本。
  const [candidateId, setCandidateId] = useState<string | null>(() => readActiveLedgerId());

  const ledger = useMemo(() => {
    // 清單還沒回來時不做任何判斷——那時候「對不上」只是因為還沒載入。
    if (ledgers.length === 0) {
      return null;
    }
    // `?? null` 是為了型別：`noUncheckedIndexedAccess` 下 `ledgers[0]` 可能是
    // undefined，即使上面已經擋掉空清單。
    return ledgers.find((item) => item.id === candidateId) ?? ledgers[0] ?? null;
  }, [ledgers, candidateId]);

  // 把實際生效的帳本記回 localStorage，下次進站才不會又走一次「退回第一本」。
  useEffect(() => {
    if (ledger) {
      writeActiveLedgerId(ledger.id);
    }
  }, [ledger]);

  const setActiveLedgerId = useCallback((ledgerId: string) => {
    setCandidateId(ledgerId);
    writeActiveLedgerId(ledgerId);
  }, []);

  const value = useMemo<ActiveLedgerContextValue>(
    () => ({ ledger, ledgers, setActiveLedgerId, isLoading, error }),
    [ledger, ledgers, setActiveLedgerId, isLoading, error],
  );

  return <ActiveLedgerContext.Provider value={value}>{children}</ActiveLedgerContext.Provider>;
}
