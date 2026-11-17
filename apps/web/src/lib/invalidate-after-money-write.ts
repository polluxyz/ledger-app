import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/** 鍵已用過時重抓紀錄，讓使用者看到先前成功的寫入。 */
export function invalidateOnReusedKey(error: unknown, invalidate: () => void): void {
  if (error instanceof ApiError && error.errorCode === 'IDEMPOTENCY_KEY_REUSED') invalidate();
}

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
