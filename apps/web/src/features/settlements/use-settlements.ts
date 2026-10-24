import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSettlementRequest,
  Paginated,
  SetAccountRequest,
  SetAccountResponse,
  SettlementResponse,
  SettlementSummary,
  Transaction,
  UpdateSettlementRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { invalidateAfterMoneyWrite } from '../../lib/invalidate-after-money-write';

/**
 * 共享帳本的結清（3e）：每個人的淨額與建議、記結清、補帳戶。
 *
 * 淨額與建議**一律由後端算**（3e spec §10），畫面只顯示 `settlement-summary` 的回應。
 * 結清路徑裡的 id 是 `LedgerSettlement.id`（交易回應的 `settlement.id`），不是交易 id。
 */
export function settlementSummaryKey(ledgerId: string | null) {
  return ['settlement-summary', ledgerId] as const;
}

/** 某本帳本已記的結清清單（3g §4.2）的共同前綴。 */
export const LEDGER_SETTLEMENTS_KEY = ['ledger-settlements'] as const;

export function ledgerSettlementsKey(ledgerId: string | null) {
  return [...LEDGER_SETTLEMENTS_KEY, ledgerId] as const;
}

/** 「載入更多」每次多拿幾筆結清。 */
export const LEDGER_SETTLEMENT_PAGE_SIZE = 20;

/**
 * 結清與補帳戶會改變交易、淨額、帳戶餘額與借還摘要。成功後呼叫
 * `invalidateAfterMoneyWrite`，和其他金額寫入入口共用同一份前綴清單。
 */
function useInvalidateSettlementWrites() {
  const queryClient = useQueryClient();
  return () => invalidateAfterMoneyWrite(queryClient);
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

/**
 * 某本帳本已記的結清，新到舊，一頁一頁載入（借還 › 歷史，3g W161）。畫面把 `data.pages` 依序攤平，`hasNextPage` 時顯示「載入更多」。
 */
export function useLedgerSettlementPages(ledgerId: string | null) {
  return useInfiniteQuery({
    queryKey: ledgerSettlementsKey(ledgerId),
    queryFn: ({ pageParam }) =>
      apiRequest<Paginated<Transaction>>(
        `/ledgers/${ledgerId as string}/settlements?page=${pageParam}&limit=${LEDGER_SETTLEMENT_PAGE_SIZE}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (last: Paginated<Transaction>) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    enabled: ledgerId !== null,
  });
}

/** 記一筆結清。付錢的人是我時省略 `fromPersonId`。 */
export function useCreateSettlement(ledgerId: string) {
  const invalidate = useInvalidateSettlementWrites();
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
  const invalidate = useInvalidateSettlementWrites();
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
  const invalidate = useInvalidateSettlementWrites();
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
  const invalidate = useInvalidateSettlementWrites();
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
  const invalidate = useInvalidateSettlementWrites();
  return useMutation({
    mutationFn: ({ settlementId, input }: { settlementId: string; input: SetAccountRequest }) =>
      apiRequest<SetAccountResponse>(`/ledgers/${ledgerId}/settlements/${settlementId}/account`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: invalidate,
  });
}
