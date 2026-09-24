import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  CreateDebtPaymentRequest,
  CreateDebtRequest,
  Debt,
  DebtSummary,
  ListDebtsQuery,
  Paginated,
  UpdateDebtRequest,
} from '@ledger/shared';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
import { apiRequest } from '../../lib/api-client';

/**
 * 借還（3b-1）的伺服器狀態。規格見 `docs/specs/phase-3b1-web.md`。
 *
 * 債務屬於使用者、不屬於帳本（`phase-3b-debts.md` 決策 17），所以 query key 不帶帳本。
 *
 * ## 寫入之後要失效的東西比交易多
 *
 * 一次債務寫入可能同時改到：債務本身、每人淨額、**任何一本帳本**的交易列表（本金與
 * 每筆還款可以各記在不同帳本，決策 18），以及帳戶餘額。所以交易快取失效的是整個
 * `['transactions']` 前綴，不是某一本帳本。少失效一個不會拋錯，只會讓畫面停在舊
 * 數字直到重整——`use-debts.test.tsx` 為每個 mutation 釘住這一整組。
 *
 * ## 前端不算任何金額
 *
 * 未清餘額、狀態、淨額、結清差額全部來自回應（spec W9）。這裡只負責打 API。
 */

/** 所有債務查詢的共同前綴：列表、單筆、淨額一次失效。 */
export const DEBTS_KEY = ['debts'] as const;

const debtListKey = (query: ListDebtsQuery) => [...DEBTS_KEY, 'list', query] as const;
const debtKey = (debtId: string) => [...DEBTS_KEY, 'detail', debtId] as const;
const DEBT_SUMMARY_KEY = [...DEBTS_KEY, 'summary'] as const;

/** 交易快取的前綴（見 `use-transactions.ts` 的 `transactionsKey`），不分帳本。 */
const ALL_TRANSACTIONS_KEY = ['transactions'] as const;

function toQueryString(query: ListDebtsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

/** 我的債務清單。狀態篩選、分頁、排序（依日期新到舊）都由後端負責。 */
export function useDebts(query: ListDebtsQuery = {}) {
  return useQuery({
    queryKey: debtListKey(query),
    queryFn: () => apiRequest<Paginated<Debt>>(`/debts${toQueryString(query)}`),
    placeholderData: keepPreviousData,
  });
}

/** 單筆債務，含還款紀錄。`null` 時不發請求（右側欄還沒選任何一筆）。 */
export function useDebt(debtId: string | null) {
  return useQuery({
    queryKey: debtKey(debtId ?? ''),
    queryFn: () => apiRequest<Debt>(`/debts/${debtId!}`),
    enabled: debtId !== null,
  });
}

/** 每人淨額。只計未結清的債務（後端規則，spec §5.4）。 */
export function useDebtSummary() {
  return useQuery({
    queryKey: DEBT_SUMMARY_KEY,
    queryFn: () => apiRequest<DebtSummary>('/debts/summary'),
  });
}

/** 任何債務寫入成功後都跑這一段。理由見檔頭「寫入之後要失效的東西比交易多」。 */
function invalidateAfterDebtWrite(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: DEBTS_KEY });
  void queryClient.invalidateQueries({ queryKey: ALL_TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
}

/** 建立一筆借出或借入。不帶 `record` 就是舊債，不產生交易（決策 7）。 */
export function useCreateDebt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDebtRequest) =>
      apiRequest<Debt>('/debts', { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}

/** 改對方名字、本金、日期、備註。結清後改本金會被後端擋下（決策 30）。 */
export function useUpdateDebt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ debtId, input }: { debtId: string; input: UpdateDebtRequest }) =>
      apiRequest<Debt>(`/debts/${debtId}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}

/** 刪除債務：後端連同所有還款與交易一起軟刪除，帳戶餘額回到借出前。 */
export function useDeleteDebt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (debtId: string) => apiRequest<void>(`/debts/${debtId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}

/**
 * 記一筆還款。
 *
 * Web 一律明確給 `record`：要記就給帳本與帳戶，不記就給 `null`。**不使用「省略」**——
 * 省略時後端會沿用本金交易的帳本與帳戶，畫面上顯示的與實際記下的可能不同（plan §2.4）。
 * 型別上仍允許省略，是因為那是 API 的合法寫法；由表單保證一定有給。
 */
export function useCreateDebtPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ debtId, input }: { debtId: string; input: CreateDebtPaymentRequest }) =>
      apiRequest<Debt>(`/debts/${debtId}/payments`, { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}

/** 刪除一筆還款，連同它的交易。刪掉結清的那筆，債務會回到未結清。 */
export function useDeleteDebtPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ debtId, paymentId }: { debtId: string; paymentId: string }) =>
      apiRequest<void>(`/debts/${debtId}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}

/** 免除剩餘金額。只限借出且未結清；不可撤銷（決策 28）。 */
export function useForgiveDebt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (debtId: string) =>
      apiRequest<Debt>(`/debts/${debtId}/forgive`, { method: 'POST' }),
    onSuccess: () => invalidateAfterDebtWrite(queryClient),
  });
}
