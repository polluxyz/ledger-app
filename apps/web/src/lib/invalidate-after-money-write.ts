import type { QueryClient } from '@tanstack/react-query';

/**
 * 金額或首頁顯示相關的寫入成功後，讓各領域快取用同一輪更新。
 * 改了某個 feature 的 key 前綴，要回來同步更新這裡與測試。
 */
export function invalidateAfterMoneyWrite(queryClient: QueryClient): void {
  const prefixes = [
    ['transactions'],
    ['transaction'],
    ['marked-transactions'],
    ['accounts'],
    ['balance-trend'],
    ['ledger-statistics'],
    ['statistics-trend'],
    ['counterparties'],
    ['ledger-groups'],
    ['settlement-summary'],
    ['ledger-settlements'],
    ['splits'],
  ] as const;

  for (const queryKey of prefixes) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
