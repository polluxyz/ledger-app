import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LedgerGroup,
  LedgerPointerResponse,
  ListLedgerGroupsQuery,
  SetLedgerPointerRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { COUNTERPARTIES_KEY } from '../debts/use-debts';

/**
 * 共享帳本的人與「指向」（3f）：`GET /ledger-groups` 與 `PUT`／`DELETE …/pointer`。
 *
 * 對象頁（W130）與借還頁（W135）都讀帳本群組，所以 hook 集中在這裡。金額、分組、有效指向
 * 都來自回應，前端只顯示（spec §7）。
 *
 * ## 失效範圍
 *
 * 指向一改，同一筆金額會從「帳本群組」搬到某個對象的 `ledgerParts`／`totalBalance`，
 * 所以對象（`COUNTERPARTIES_KEY`）與帳本群組（`LEDGER_GROUPS_KEY`）一起失效。
 * 反過來，任何會改變共享帳本結清轉帳的寫入（交易、結清），也要失效這兩組。
 */

/** 帳本群組的共同前綴，`unpointed` 與完整版一次失效。 */
export const LEDGER_GROUPS_KEY = ['ledger-groups'] as const;

const ledgerGroupsKey = (query: ListLedgerGroupsQuery) => [...LEDGER_GROUPS_KEY, query] as const;

/** 我參與過的共享帳本，每本一組。`unpointed: true` 只回沒指向且有金額的人（借還頁）。 */
export function useLedgerGroups(query: ListLedgerGroupsQuery = {}) {
  return useQuery({
    queryKey: ledgerGroupsKey(query),
    queryFn: () =>
      apiRequest<LedgerGroup[]>(
        query.unpointed === true ? '/ledger-groups?unpointed=true' : '/ledger-groups',
      ),
  });
}

function useInvalidatePointers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: COUNTERPARTIES_KEY });
    void queryClient.invalidateQueries({ queryKey: LEDGER_GROUPS_KEY });
  };
}

interface PointerTarget {
  ledgerId: string;
  personId: string;
}

/** 設定指向。`counterpartyId: null`＝明確「不指向」。已退出的帳本回 409 `LEDGER_LEFT`。 */
export function useSetLedgerPointer() {
  const invalidate = useInvalidatePointers();
  return useMutation({
    mutationFn: ({ ledgerId, personId, ...body }: PointerTarget & SetLedgerPointerRequest) =>
      apiRequest<LedgerPointerResponse>(`/ledgers/${ledgerId}/people/${personId}/pointer`, {
        method: 'PUT',
        body,
      }),
    onSuccess: invalidate,
  });
}

/** 清掉設定，回到自動指向。 */
export function useClearLedgerPointer() {
  const invalidate = useInvalidatePointers();
  return useMutation({
    mutationFn: ({ ledgerId, personId }: PointerTarget) =>
      apiRequest<LedgerPointerResponse>(`/ledgers/${ledgerId}/people/${personId}/pointer`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
}
