import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLedgerRequest,
  LedgerDetail,
  LedgerLeavePreview,
  LedgerRemovalPreview,
  LedgerSummary,
  LeaveMove,
  LeaveRequest,
} from '@ledger/shared';
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
 *
 * `enabled` 供 `ActiveLedgerProvider` 使用：它掛在路由之上、無法「未登入就不
 * 渲染」，而訪客沒有 token，打這個端點必定 401。
 */
export function useLedgers(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: ledgersKey(includeArchived),
    queryFn: () =>
      apiRequest<LedgerSummary[]>(`/ledgers${includeArchived ? '?includeArchived=true' : ''}`),
    enabled,
  });
}

/** 編輯者與擁有者可寫入尚未封存的帳本。 */
export function isLedgerWritable(ledger: Pick<LedgerSummary, 'role' | 'archivedAt'> | undefined) {
  return ledger !== undefined && ledger.role !== 'VIEWER' && ledger.archivedAt === null;
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
 * 以下四個 mutation 都不攔截錯誤——`apiRequest` 已把後端的統一錯誤格式轉成
 * `ApiError`，呼叫端交給 `FormError` 呈現。訊息內容仍由後端定義；前端只負責把
 * `errorCode` 對應到在地化字串（`lib/error-messages.ts`），對不到的代碼就原樣
 * 顯示後端訊息。
 */

/** 建立帳本。 */
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
 * 帳本改名只送 `name`，帳本類型建立後不可更改。
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
    mutationFn: ({
      id,
      confirm,
      withdrawDebts,
    }: {
      id: string;
      confirm: string;
      withdrawDebts?: boolean;
    }) => {
      const query = new URLSearchParams({ confirm });
      if (withdrawDebts) {
        query.set('withdrawDebts', 'true');
      }
      return apiRequest<void>(`/ledgers/${id}?${query.toString()}`, { method: 'DELETE' });
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      queryClient.removeQueries({ queryKey: ['ledger', id] });
    },
  });
}

/** 已封存帳本的取消封存動作；成功後更新切換器與明細快取。 */
export function useUnarchiveLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<LedgerDetail>(`/ledgers/${id}/unarchive`, { method: 'POST' }),
    onSuccess: (ledger) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledger.id] });
    },
  });
}

/** 刪除帳本前的伺服器計算預覽；每次打開刪除對話框都重新查詢。 */
export function useRemovalPreview(ledgerId: string, enabled = true) {
  return useQuery({
    queryKey: ['ledger-removal-preview', ledgerId],
    queryFn: () => apiRequest<LedgerRemovalPreview>(`/ledgers/${ledgerId}/removal-preview`),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * 退出／刪除共享帳本前的伺服器預覽。所有可能改變結果的輸入都放進 query key，
 * 因此勾選狀態快速變動時，舊請求只會寫回舊 key，不會蓋掉目前畫面。
 * `keepPreviousData`：新的勾選還在算時先留著上一份，帳戶段不會每勾一次就閃掉。
 */
export function useLeavePreview(
  ledgerId: string,
  request: Required<Pick<LeaveRequest, 'targetLedgerId' | 'excludedItemIds'>> &
    Pick<LeaveRequest, 'deleteLedger'>,
  enabled = true,
) {
  const excludedItemIds = [...request.excludedItemIds].sort();
  return useQuery({
    queryKey: [
      'ledger-leave-preview',
      ledgerId,
      request.targetLedgerId,
      excludedItemIds,
      request.deleteLedger ?? false,
    ],
    queryFn: () =>
      apiRequest<LedgerLeavePreview>(`/ledgers/${ledgerId}/leave-preview`, {
        method: 'POST',
        body: { ...request, excludedItemIds },
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** 私人帳本刪除預覽；分組搬移每次變更都以完整 moves 作為獨立快取鍵。 */
export function useDeleteLedgerPreview(
  ledgerId: string,
  moves: readonly LeaveMove[],
  enabled = true,
) {
  const requestMoves = moves.map((move) => ({
    targetLedgerId: move.targetLedgerId,
    itemIds: [...move.itemIds].sort(),
  }));

  return useQuery({
    queryKey: ['ledger-delete-preview', ledgerId, requestMoves],
    queryFn: () =>
      apiRequest<LedgerLeavePreview>(`/ledgers/${ledgerId}/leave-preview`, {
        method: 'POST',
        body: { deleteLedger: true, moves: requestMoves },
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** 執行退出或「先合併再刪除」；成功後讓帳本、帳戶與往來頁面重讀伺服器資料。 */
export function useLeaveLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...request }: LeaveRequest & { id: string }) =>
      apiRequest<void>(`/ledgers/${id}/leave`, { method: 'POST', body: request }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
      void queryClient.removeQueries({ queryKey: ['ledger', id] });
      void queryClient.invalidateQueries({ queryKey: ['members', id] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['counterparties'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger-settlements'] });
    },
  });
}
