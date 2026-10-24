import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Counterparty,
  CreateCounterpartyRequest,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  DebtEntry,
  DebtEntrySection,
  ForgiveCounterpartyRequest,
  ListCounterpartiesQuery,
  ListDebtEntriesQuery,
  MergeCounterpartyRequest,
  Paginated,
  UpdateDebtEntryRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { invalidateAfterMoneyWrite } from '../../lib/invalidate-after-money-write';

/**
 * 借還（3b-1 往來帳版）的伺服器狀態。規格見 `docs/specs/phase-3b1-web.md`。
 *
 * 往來帳屬於使用者、不屬於帳本（`phase-3b-debts.md` 決策 17），所以 query key 不帶帳本。
 *
 * ## 寫入後更新相關快取
 *
 * 往來寫入可能影響對象餘額、往來紀錄、不同帳本的交易與帳戶餘額，成功後一律呼叫
 * `invalidateAfterMoneyWrite`。解除連動另外保留邀請與提議的前綴；測試逐一核對共用與自有清單。
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
const entriesKey = (id: string, query: ListDebtEntriesQuery) =>
  [...COUNTERPARTIES_KEY, 'entries', id, query] as const;
const entryPagesKey = (id: string, section: DebtEntrySection) =>
  [...COUNTERPARTIES_KEY, 'entry-pages', id, section] as const;

/** 「載入更多」每次多拿幾筆往來紀錄（3g 決策 155）。 */
export const DEBT_ENTRY_PAGE_SIZE = 20;

function toQueryString(query: ListCounterpartiesQuery | ListDebtEntriesQuery): string {
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
  query: ListDebtEntriesQuery = {},
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

/**
 * 某個對象的未還清或已還清紀錄，一頁一頁載入（3g 決策 153、155）。分界由後端算（`section`），
 * 畫面把 `data.pages` 依序攤平顯示，`hasNextPage` 時顯示「載入更多」。`null` 時不發請求。
 */
export function useCounterpartyEntryPages(
  counterpartyId: string | null,
  section: DebtEntrySection,
) {
  return useInfiniteQuery({
    queryKey: entryPagesKey(counterpartyId ?? '', section),
    queryFn: ({ pageParam }) =>
      apiRequest<Paginated<DebtEntry>>(
        `/counterparties/${counterpartyId!}/entries${toQueryString({
          section,
          page: pageParam,
          limit: DEBT_ENTRY_PAGE_SIZE,
        })}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (last: Paginated<DebtEntry>) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    enabled: counterpartyId !== null,
  });
}

/**
 * 記一筆往來。`record` 一定要提供帳本與帳戶（3h 決策 163）。
 */
export function useCreateDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDebtEntryRequest) =>
      apiRequest<CreateDebtEntryResponse>('/debt-entries', { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/** 改一筆往來的金額、日期、備註。結清差額與免除不能改（409 `DEBT_ENTRY_NOT_EDITABLE`）。 */
export function useUpdateDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: UpdateDebtEntryRequest }) =>
      apiRequest<DebtEntry>(`/debt-entries/${entryId}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/** 刪除一筆往來，連同它的交易。帳戶餘額與往來餘額都回到記這筆之前。 */
export function useDeleteDebtEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      apiRequest<void>(`/debt-entries/${entryId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/**
 * 對象改名，或設定、清掉暱稱（3b-2 修訂 1）。`name: null` 只允許已連動的對象，清掉後顯示
 * 回帳號名稱。撞名回 409 `COUNTERPARTY_NAME_TAKEN`。名字也出現在交易列表，所以一樣全部失效。
 */
export function useRenameCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterpartyId, name }: { counterpartyId: string; name: string | null }) =>
      apiRequest<Counterparty>(`/counterparties/${counterpartyId}`, {
        method: 'PATCH',
        body: { name },
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/** 刪除對象。還有往來紀錄時回 409 `COUNTERPARTY_HAS_ENTRIES`。 */
export function useDeleteCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterpartyId: string) =>
      apiRequest<void>(`/counterparties/${counterpartyId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/** 免除對方欠我的剩餘金額。對方沒欠我時回 409 `NOTHING_TO_FORGIVE`。 */
export function useForgiveCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      counterpartyId,
      ...input
    }: { counterpartyId: string } & ForgiveCounterpartyRequest) =>
      apiRequest<CreateDebtEntryResponse>(`/counterparties/${counterpartyId}/forgive`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

// ---------------------------------------------------------------------------
// 3b-2：不記帳先加人、邀請連動、解除連動（spec `phase-3b2-web.md` W26、W28、W27）
// ---------------------------------------------------------------------------

/** 送出與收到的連動邀請、提議的快取前綴。定義在 `use-linking.ts`，這裡只為了失效。 */
const FRIEND_REQUESTS_KEY = ['friend-requests'] as const;
const DEBT_PROPOSALS_KEY = ['debt-proposals'] as const;

/** 不記帳先新增一個人（決策 55）。撞名回 409 `COUNTERPARTY_NAME_TAKEN`。 */
export function useCreateCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCounterpartyRequest) =>
      apiRequest<Counterparty>('/counterparties', { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/**
 * 解除連動（決策 70、71）。對象、名字與紀錄都保留；待確認的提議與邀請由後端一併取消，
 * 所以共用金額快取以外，也要失效待確認邀請與提議。
 */
export function useUnlinkCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterpartyId: string) =>
      apiRequest<void>(`/counterparties/${counterpartyId}/link`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAfterMoneyWrite(queryClient);
      void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY });
    },
  });
}

/**
 * 合併之前的紀錄（決策 76）：把 `sourceId`（未連動）併進 `counterpartyId`（已連動）。
 * 紀錄與餘額搬過去、名字可能改變，也會清掉待詢問，所以使用共用金額失效清單。
 */
export function useMergeCounterparty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      counterpartyId,
      sourceId,
    }: { counterpartyId: string } & MergeCounterpartyRequest) =>
      apiRequest<Counterparty>(`/counterparties/${counterpartyId}/merge`, {
        method: 'POST',
        body: { sourceId },
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/** 回答「沒有」：清掉待詢問標記（決策 75）。 */
export function useDismissMergePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterpartyId: string) =>
      apiRequest<void>(`/counterparties/${counterpartyId}/merge-prompt`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}
