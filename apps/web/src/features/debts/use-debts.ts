import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Counterparty,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  DebtEntry,
  ListCounterpartiesQuery,
  Paginated,
  UpdateDebtEntryRequest,
} from '@ledger/shared';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
import { apiRequest } from '../../lib/api-client';

/**
 * 借還（3b-1 往來帳版）的伺服器狀態。規格見 `docs/specs/phase-3b1-web.md`。
 *
 * 往來帳屬於使用者、不屬於帳本（`phase-3b-debts.md` 決策 17），所以 query key 不帶帳本。
 *
 * ## 寫入之後要失效的東西比交易多
 *
 * 一次往來寫入可能同時改到：對象清單與餘額、那個對象的往來紀錄、**任何一本帳本**的交易
 * 列表（紀錄可以記進不同帳本），以及帳戶餘額。所以對象與往來紀錄共用 `['counterparties']`
 * 前綴一次失效，交易失效的是整個 `['transactions']` 前綴。少失效一個不會拋錯，只會讓畫面
 * 停在舊數字直到重整——`use-debts.test.tsx` 為每個 mutation 釘住這一整組。
 *
 * ## 前端不算往來餘額
 *
 * 餘額、`balanceAfter` 全部來自回應（spec W16 之外沒有例外）。這裡只負責打 API。
 */

/** 對象與往來紀錄的共同前綴：清單、單一對象、往來紀錄一次失效。 */
export const COUNTERPARTIES_KEY = ['counterparties'] as const;

const counterpartyListKey = (query: ListCounterpartiesQuery) =>
  [...COUNTERPARTIES_KEY, 'list', query] as const;
const counterpartyKey = (id: string) => [...COUNTERPARTIES_KEY, 'detail', id] as const;
const entriesKey = (id: string, query: ListCounterpartiesQuery) =>
  [...COUNTERPARTIES_KEY, 'entries', id, query] as const;

/** 交易快取的前綴（見 `use-transactions.ts` 的 `transactionsKey`），不分帳本。 */
const ALL_TRANSACTIONS_KEY = ['transactions'] as const;

function toQueryString(query: ListCounterpartiesQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

/** 我的往來對象與餘額。排序（有餘額的在前）與分頁由後端負責。 */
export function useCounterparties(query: ListCounterpartiesQuery = {}) {
  return useQuery({
    queryKey: counterpartyListKey(query),
    queryFn: () => apiRequest<Paginated<Counterparty>>(`/counterparties${toQueryString(query)}`),
    placeholderData: keepPreviousData,
  });
}

/** 單一對象。`null` 時不發請求（右側欄還沒選任何人）。 */
export function useCounterparty(counterpartyId: string | null) {
  return useQuery({
    queryKey: counterpartyKey(counterpartyId ?? ''),
    queryFn: () => apiRequest<Counterparty>(`/counterparties/${counterpartyId!}`),
    enabled: counterpartyId !== null,
  });
}

/** 某個對象的往來紀錄，新到舊，每筆附 `balanceAfter`。 */
export function useCounterpartyEntries(
  counterpartyId: string | null,
  query: ListCounterpartiesQuery = {},
) {
  return useQuery({
    queryKey: entriesKey(counterpartyId ?? '', query),
    queryFn: () =>
      apiRequest<Paginated<DebtEntry>>(
        `/counterparties/${counterpartyId!}/entries${toQueryString(query)}`,
      ),
    enabled: counterpartyId !== null,
    placeholderData: keepPreviousData,
  });
}

/** 任何往來寫入成功後都跑這一段。理由見檔頭「寫入之後要失效的東西比交易多」。 */
function invalidateAfterWrite(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: COUNTERPARTIES_KEY });
  void queryClient.invalidateQueries({ queryKey: ALL_TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
}

/**
 * 記一筆往來。`record` 一定要明確給（物件或 `null`）——後端不再有「省略就沿用」的行為，
 * 省略會得到 400（`phase-3b-debts.md` §5.2）。
 */
export function useCreateDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDebtEntryRequest) =>
      apiRequest<CreateDebtEntryResponse>('/debt-entries', { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 改一筆往來的金額、日期、備註。結清差額與免除不能改（409 `DEBT_ENTRY_NOT_EDITABLE`）。 */
export function useUpdateDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: UpdateDebtEntryRequest }) =>
      apiRequest<DebtEntry>(`/debt-entries/${entryId}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 刪除一筆往來，連同它的交易。帳戶餘額與往來餘額都回到記這筆之前。 */
export function useDeleteDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      apiRequest<void>(`/debt-entries/${entryId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 對象改名。撞名回 409 `COUNTERPARTY_NAME_TAKEN`。名字也出現在交易列表，所以一樣全部失效。 */
export function useRenameCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterpartyId, name }: { counterpartyId: string; name: string }) =>
      apiRequest<Counterparty>(`/counterparties/${counterpartyId}`, {
        method: 'PATCH',
        body: { name },
      }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 刪除對象。還有往來紀錄時回 409 `COUNTERPARTY_HAS_ENTRIES`。 */
export function useDeleteCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterpartyId: string) =>
      apiRequest<void>(`/counterparties/${counterpartyId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 免除對方欠我的剩餘金額。對方沒欠我時回 409 `NOTHING_TO_FORGIVE`。 */
export function useForgiveCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterpartyId: string) =>
      apiRequest<CreateDebtEntryResponse>(`/counterparties/${counterpartyId}/forgive`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}
