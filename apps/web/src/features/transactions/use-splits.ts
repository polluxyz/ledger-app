import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateSplitRequest,
  Split,
  UpdateSplitRequest,
  UpdateSplitResponse,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
import { COUNTERPARTIES_KEY } from '../debts/use-debts';
import { DEBT_PROPOSALS_KEY } from '../linking/use-linking';

/** 分帳與相關資料共用的快取前綴。 */
export const SPLITS_KEY = ['splits'] as const;
const ALL_TRANSACTIONS_KEY = ['transactions'] as const;

function invalidateAfterWrite(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: SPLITS_KEY });
  void queryClient.invalidateQueries({ queryKey: ALL_TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: COUNTERPARTIES_KEY });
  void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
  void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY });
}

/** 讀取完整分帳，編輯表單用它還原付款人、名單、分法與精度。 */
export function useSplit(splitId: string | null) {
  return useQuery({
    queryKey: [...SPLITS_KEY, splitId],
    queryFn: () => apiRequest<Split>(`/splits/${splitId!}`),
    enabled: splitId !== null,
  });
}

/** 建立分帳；交易、帳戶、往來與新送出的待確認提議一併重新查詢。 */
export function useCreateSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSplitRequest) =>
      apiRequest<Split>('/splits', { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 整份取代分帳內容；後端回應也可能表示分帳已解散成一般交易。 */
export function useUpdateSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ splitId, input }: { splitId: string; input: UpdateSplitRequest }) =>
      apiRequest<UpdateSplitResponse>(`/splits/${splitId}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}

/** 刪除分帳及其交易與往來，所有依賴 API 狀態的畫面都重新載入。 */
export function useDeleteSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (splitId: string) => apiRequest<void>(`/splits/${splitId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAfterWrite(queryClient),
  });
}
