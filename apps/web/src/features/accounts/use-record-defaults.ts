import { useQuery } from '@tanstack/react-query';
import type { RecordDefaults } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/** 記帳表單預設值的 query key 前綴；第二段是帳本已固定時的帳本 id，沒有就是 `null`。 */
export const RECORD_DEFAULTS_KEY = ['record-defaults'] as const;

/**
 * 記帳表單預設帶入的帳本與帳戶（3h 決策 174、W177）。
 *
 * 「最近一次」由後端查（跟著帳號走，換裝置也一樣），前端不自己記。
 *
 * - 表單有「帳本」欄位（借還）：不帶 `ledgerId`，帳本與帳戶都用回應的值。
 * - 帳本已由頁面決定（明細的新增交易、共享帳本的結清）：帶 `ledgerId`，只用回應的 `accountId`，
 *   後端回「我在這本帳本最近用的帳戶」，沒用過才回整體最近一次。
 *
 * 只在表單第一次拿到值時帶入；使用者改過的值不被覆蓋（W177），由呼叫端控制。
 * 用預設的 `staleTime: 0`：每次打開表單都重抓，剛記完的那一筆馬上算進「最近一次」。
 */
export function useRecordDefaults(ledgerId?: string) {
  return useQuery({
    queryKey: [...RECORD_DEFAULTS_KEY, ledgerId ?? null],
    queryFn: () =>
      apiRequest<RecordDefaults>(
        ledgerId === undefined
          ? '/users/me/record-defaults'
          : `/users/me/record-defaults?ledgerId=${encodeURIComponent(ledgerId)}`,
      ),
  });
}
