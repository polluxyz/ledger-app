import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSettlementRequest,
  SetAccountRequest,
  SetAccountResponse,
  SettlementResponse,
  SettlementSummary,
  UpdateSettlementRequest,
} from '@ledger/shared';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
import { apiRequest } from '../../lib/api-client';

/**
 * 共享帳本的結清（3e）：每個人的淨額與建議、記結清、補帳戶。
 *
 * 淨額與建議**一律由後端算**（3e spec §10），畫面只顯示 `settlement-summary` 的回應。
 * 結清路徑裡的 id 是 `LedgerSettlement.id`（交易回應的 `settlement.id`），不是交易 id。
 */
export function settlementSummaryKey(ledgerId: string | null) {
  return ['settlement-summary', ledgerId] as const;
}

/**
 * 結清與補帳戶都會動到三件事：交易列表（結清是一筆轉帳）、淨額、帳戶餘額。
 * 少了任何一個都不會報錯，只會讓畫面停在舊數字，所以集中在這裡一起失效。
 *
 * 交易列表的 key 直接寫字面值，不從 `use-transactions` 匯入：那一份反過來要匯入
 * 本檔的 `settlementSummaryKey`，互相匯入會形成循環。
 */
function useInvalidateSettlementWrites(ledgerId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
    void queryClient.invalidateQueries({ queryKey: settlementSummaryKey(ledgerId) });
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
  };
}

/** 每個人的淨額＋結清建議。只有共享帳本有，呼叫端傳 `enabled`。 */
export function useSettlementSummary(ledgerId: string | null, enabled = true) {
  return useQuery({
    queryKey: settlementSummaryKey(ledgerId),
    queryFn: () =>
      apiRequest<SettlementSummary>(`/ledgers/${ledgerId as string}/settlement-summary`),
    enabled: ledgerId !== null && enabled,
  });
}

/** 記一筆結清。付錢的人是我時省略 `fromPersonId`。 */
export function useCreateSettlement(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites(ledgerId);
  return useMutation({
    mutationFn: (input: CreateSettlementRequest) =>
      apiRequest<SettlementResponse>(`/ledgers/${ledgerId}/settlements`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/** 改一筆結清。`settlementId` 是 `transaction.settlement.id`。 */
export function useUpdateSettlement(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites(ledgerId);
  return useMutation({
    mutationFn: ({
      settlementId,
      input,
    }: {
      settlementId: string;
      input: UpdateSettlementRequest;
    }) =>
      apiRequest<SettlementResponse>(`/ledgers/${ledgerId}/settlements/${settlementId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/** 刪除一筆結清（後端軟刪除那筆轉帳）。 */
export function useDeleteSettlement(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites(ledgerId);
  return useMutation({
    mutationFn: (settlementId: string) =>
      apiRequest<void>(`/ledgers/${ledgerId}/settlements/${settlementId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/**
 * 付款人補自己在一筆交易的帳戶（帳戶待補）。VIEWER 也能呼叫；不是付款人時後端回
 * 400 `ACCOUNT_NOT_PAYERS`。
 */
export function useSetTransactionAccount(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites(ledgerId);
  return useMutation({
    mutationFn: ({ transactionId, input }: { transactionId: string; input: SetAccountRequest }) =>
      apiRequest<SetAccountResponse>(`/ledgers/${ledgerId}/transactions/${transactionId}/account`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/** 付錢或收錢的人補自己那一邊的結清帳戶。`settlementId` 是 `transaction.settlement.id`。 */
export function useSetSettlementAccount(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites(ledgerId);
  return useMutation({
    mutationFn: ({ settlementId, input }: { settlementId: string; input: SetAccountRequest }) =>
      apiRequest<SetAccountResponse>(`/ledgers/${ledgerId}/settlements/${settlementId}/account`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: invalidate,
  });
}
