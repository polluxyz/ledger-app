import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateLedgerRequest, LedgerDetail, LedgerSummary } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 帳本的伺服器狀態。
 *
 * query key 的第二段是 `includeArchived`——**它一定要在 key 裡**。少了它，勾選
 * 「顯示已封存」拿回來的清單會覆蓋掉原本那份，取消勾選時又讀到含封存的舊快取。
 * 症狀是清單內容忽多忽少，不會拋錯，也不會讓測試變紅。
 *
 * 失效時用 `LEDGERS_KEY`（不帶第二段）即可——react-query 是前綴比對，兩份清單
 * 會一起失效。
 */
export const LEDGERS_KEY = ['ledgers'] as const;

/** 某一種篩選條件下的帳本清單 key。 */
function ledgersKey(includeArchived: boolean) {
  return [...LEDGERS_KEY, includeArchived] as const;
}

/**
 * 使用者所屬的帳本清單（後端只會回傳他有權存取的）。
 *
 * `includeArchived` 交給後端處理，前端不自行過濾——後端已經提供這個參數，
 * 在前端篩選等於把判斷搬到不該去的地方，帳本一多也是白拿資料。
 */
export function useLedgers(includeArchived = false) {
  return useQuery({
    queryKey: ledgersKey(includeArchived),
    queryFn: () =>
      apiRequest<LedgerSummary[]>(`/ledgers${includeArchived ? '?includeArchived=true' : ''}`),
  });
}

/** 單一帳本的明細，含成員清單。無權存取時後端回 404（不是 403）。 */
export function useLedger(ledgerId: string | null) {
  return useQuery({
    queryKey: ['ledger', ledgerId],
    queryFn: () => apiRequest<LedgerDetail>(`/ledgers/${ledgerId as string}`),
    enabled: ledgerId !== null,
  });
}

/**
 * 目前作用中的帳本。Slice 0 先固定取第一本——註冊時自動建立的個人帳本；
 * 帳本切換與管理留到 Slice 2 Step 2（改由 ActiveLedgerProvider 提供）。
 */
export function useCurrentLedger() {
  const query = useLedgers();
  return { ...query, ledger: query.data?.[0] ?? null };
}

/**
 * 以下四個 mutation 都不攔截錯誤——`apiRequest` 已把後端的統一錯誤格式轉成
 * `ApiError`，呼叫端交給 `FormError` 呈現即可。前端不自行改寫錯誤訊息：
 * 那是後端的職責，重寫只會讓兩邊講法不一致。
 */

/** 建立帳本。`tracksBalance` 建立後即定案，之後無法變更。 */
export function useCreateLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateLedgerRequest) =>
      apiRequest<LedgerSummary>('/ledgers', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
    },
  });
}

/**
 * 帳本改名。**只送 `name`**——`tracksBalance` 帶上去會被後端退成 400
 * `TRACKS_BALANCE_IMMUTABLE`，那是刻意的，不是可以繞過的限制。
 */
export function useRenameLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest<LedgerDetail>(`/ledgers/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: (ledger) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledger.id] });
    },
  });
}

/**
 * 封存帳本：轉為唯讀，並從預設清單中收起。
 *
 * ⚠️ **這個動作無法復原**——後端沒有解除封存的端點（決議見
 * `tasks/phase-2b-slice-2-plan.md` D3）。呼叫端必須先讓使用者打字輸入帳本名稱確認。
 */
export function useArchiveLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<LedgerDetail>(`/ledgers/${id}/archive`, { method: 'POST' }),
    onSuccess: (ledger) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledger.id] });
    },
  });
}

/**
 * 刪除帳本。後端要求 `confirm` 與帳本名稱完全相符，否則回 400——所以呼叫端
 * 一定要有一個讓使用者打字的輸入框，這是契約而非 UI 選擇。
 *
 * 帳本內若有其他成員記的交易，後端回 409 `LEDGER_HAS_OTHERS_TRANSACTIONS`，
 * 該情況請引導使用者改用封存。
 */
export function useDeleteLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    // 成功時後端回 204 無 body，`apiRequest` 會回 undefined。
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) =>
      apiRequest<void>(`/ledgers/${id}?confirm=${encodeURIComponent(confirm)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      queryClient.removeQueries({ queryKey: ['ledger', id] });
    },
  });
}
