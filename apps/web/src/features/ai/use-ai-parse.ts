import { useCallback, useState } from 'react';
import type { ParseTransactionRequest, ParseTransactionResponse } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/** AI 解析只走 POST 端點；草稿留給呼叫端放在頁面 state，不進 React Query 快取。 */
export function useAiParse() {
  const [isPending, setIsPending] = useState(false);

  const parse = useCallback(async (request: ParseTransactionRequest) => {
    setIsPending(true);
    try {
      return await apiRequest<ParseTransactionResponse>('/ai/parse-transaction', {
        method: 'POST',
        body: request,
      });
    } finally {
      setIsPending(false);
    }
  }, []);

  return { parse, isPending };
}
