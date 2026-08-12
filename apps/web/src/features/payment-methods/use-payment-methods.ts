import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/** 某帳本的付款方式。不分收入 / 支出——付款方式不綁 type。 */
export function usePaymentMethods(ledgerId: string | null) {
  return useQuery({
    queryKey: ['payment-methods', ledgerId],
    queryFn: () => apiRequest<PaymentMethod[]>(`/ledgers/${ledgerId!}/payment-methods`),
    enabled: ledgerId !== null,
  });
}
