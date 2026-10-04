import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLedgerPersonRequest,
  LedgerPerson,
  UpdateLedgerPersonRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { settlementSummaryKey } from '../settlements/use-settlements';
import { transactionsKey } from '../transactions/use-transactions';

/**
 * 共享帳本裡的人（3e：成員、非成員、已離開的成員），端點是 `/ledgers/:ledgerId/people`。
 *
 * 只有 `SHARED` 帳本有這組端點，個人帳本打了會 404，所以呼叫端要傳 `enabled`
 * （通常是 `ledger.kind === 'SHARED'`）。誰能新增、改名、刪除由後端的角色檢查決定；
 * 畫面依角色隱藏按鈕只是體驗。
 */
export function ledgerPeopleKey(ledgerId: string) {
  return ['ledger-people', ledgerId] as const;
}

/** 帳本裡的人，依建立順序；含已離開的成員（`status: 'LEFT'`）。 */
export function useLedgerPeople(ledgerId: string | null, enabled = true) {
  return useQuery({
    queryKey: ledgerPeopleKey(ledgerId ?? ''),
    queryFn: () => apiRequest<LedgerPerson[]>(`/ledgers/${ledgerId as string}/people`),
    enabled: ledgerId !== null && enabled,
  });
}

/**
 * 人的名字會出現在交易回應（`payer`、名單）與結清檢視裡，所以新增、改名、刪除之後
 * 三份快取一起失效，畫面才不會留著舊名字。
 */
function useInvalidatePeople(ledgerId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ledgerPeopleKey(ledgerId) });
    void queryClient.invalidateQueries({ queryKey: transactionsKey(ledgerId) });
    void queryClient.invalidateQueries({ queryKey: settlementSummaryKey(ledgerId) });
  };
}

/** 新增非成員。名字重複回 409 `LEDGER_PERSON_NAME_TAKEN`。 */
export function useCreateLedgerPerson(ledgerId: string) {
  const invalidate = useInvalidatePeople(ledgerId);
  return useMutation({
    mutationFn: (input: CreateLedgerPersonRequest) =>
      apiRequest<LedgerPerson>(`/ledgers/${ledgerId}/people`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

/** 非成員改名。成員那一筆不能改（400）。 */
export function useRenameLedgerPerson(ledgerId: string) {
  const invalidate = useInvalidatePeople(ledgerId);
  return useMutation({
    mutationFn: ({ personId, input }: { personId: string; input: UpdateLedgerPersonRequest }) =>
      apiRequest<LedgerPerson>(`/ledgers/${ledgerId}/people/${personId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/** 刪除沒用到的非成員。還在交易或結清裡時回 409 `LEDGER_PERSON_IN_USE`。 */
export function useDeleteLedgerPerson(ledgerId: string) {
  const invalidate = useInvalidatePeople(ledgerId);
  return useMutation({
    mutationFn: (personId: string) =>
      apiRequest<void>(`/ledgers/${ledgerId}/people/${personId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
