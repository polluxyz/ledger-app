import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarkedTransactions, useSetTransactionMark } from './use-marks';
import { useTransactions } from './use-transactions';

/** 標註 API 的路徑、HTTP 方法、分頁與快取失效；測試只 mock API fetch。 */
describe('transaction marks', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('requests the first ten marks, then fetches every page on expansion', async () => {
    fetchMock.mockImplementation((url) => {
      const parsed = new URL(String(url), 'http://localhost');
      const page = Number(parsed.searchParams.get('page'));
      const limit = Number(parsed.searchParams.get('limit'));
      const total = 205;
      const items = Array.from({ length: Math.min(limit, total - (page - 1) * limit) }, () => ({}));
      return Promise.resolve(
        new Response(JSON.stringify({ items, page, limit, total }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const { result, rerender } = renderHook(
      ({ expanded }: { expanded: boolean }) => useMarkedTransactions(expanded),
      { initialProps: { expanded: false }, wrapper },
    );
    await waitFor(() => expect(result.current.data?.items).toHaveLength(10));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/transactions/marked?page=1&limit=10');

    rerender({ expanded: true });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(205));
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/transactions/marked?page=1&limit=100'),
        expect.stringContaining('/transactions/marked?page=2&limit=100'),
        expect.stringContaining('/transactions/marked?page=3&limit=100'),
      ]),
    );
  });

  it('uses PUT to mark and DELETE to unmark, refreshing transaction and marked queries', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/mark')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const body = String(url).includes('/transactions/marked')
        ? { items: [], page: 1, limit: 10, total: 0 }
        : { items: [], page: 1, limit: 20, total: 0 };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    const { result: queries } = renderHook(
      () => ({ marked: useMarkedTransactions(), transactions: useTransactions('ledger-1') }),
      { wrapper },
    );
    await waitFor(() => {
      expect(queries.current.marked.data).toBeDefined();
      expect(queries.current.transactions.data).toBeDefined();
    });
    const { result } = renderHook(() => useSetTransactionMark(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        ledgerId: 'ledger-1',
        transactionId: 'txn-1',
        marked: false,
      });
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ledgers/ledger-1/transactions/txn-1/mark'),
        expect.objectContaining({ method: 'PUT' }),
      ),
    );

    await act(async () => {
      await result.current.mutateAsync({
        ledgerId: 'ledger-1',
        transactionId: 'txn-1',
        marked: true,
      });
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ledgers/ledger-1/transactions/txn-1/mark'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(6));
  });
});
