import { useQuery } from '@tanstack/react-query';
import type { LedgerSummary } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/** 使用者所屬的帳本清單（後端只會回傳他有權存取的）。 */
export function useLedgers() {
  return useQuery({
    queryKey: ['ledgers'],
    queryFn: () => apiRequest<LedgerSummary[]>('/ledgers'),
  });
}

/**
 * 目前作用中的帳本。Slice 0 先固定取第一本——註冊時自動建立的個人帳本；
 * 帳本切換與管理留到 Slice 1。
 */
export function useCurrentLedger() {
  const query = useLedgers();
  return { ...query, ledger: query.data?.[0] ?? null };
}
