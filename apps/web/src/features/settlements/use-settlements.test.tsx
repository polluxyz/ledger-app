import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateLedgerPerson,
  useDeleteLedgerPerson,
  useLedgerPeople,
  useRenameLedgerPerson,
} from '../ledger-people/use-ledger-people';
import { COUNTERPARTIES_KEY } from '../debts/use-debts';
import { LEDGER_GROUPS_KEY } from '../ledger-people/use-ledger-pointers';
import {
  useCreateSettlement,
  useDeleteSettlement,
  useSetSettlementAccount,
  useSetTransactionAccount,
  useSettlementSummary,
  useUpdateSettlement,
} from './use-settlements';

/**
 * 3e 的資料 hook：帳本裡的人與結清。只驗 API 契約（方法、路徑、body）與快取失效；
 * 網路一律 mock，不依賴後端版本。
 *
 * 失效清單是這組測試的重點：結清與補帳戶同時改變交易列表、淨額、帳戶餘額，少失效
 * 任何一份都不會報錯，只會讓畫面停在舊數字。
 */
describe('3e data hooks', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ id: 'x', people: [], suggestions: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    );
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
    return {
      // BASE_URL 依環境不同，只比對 /ledgers 之後的路徑。
      url: url.slice(url.indexOf('/ledgers')),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  }

  function invalidatedKeys() {
    return (invalidate.mock.calls as unknown as Array<[{ queryKey: unknown }]>).map(
      ([filters]) => filters.queryKey,
    );
  }

  it('reads people and the summary only when enabled', async () => {
    renderHook(() => useLedgerPeople('ledger-1', false), { wrapper });
    renderHook(() => useSettlementSummary('ledger-1', false), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();

    const people = renderHook(() => useLedgerPeople('ledger-1'), { wrapper });
    await waitFor(() => expect(people.result.current.isSuccess).toBe(true));
    expect(lastRequest()).toMatchObject({ url: '/ledgers/ledger-1/people', method: 'GET' });

    const summary = renderHook(() => useSettlementSummary('ledger-1'), { wrapper });
    await waitFor(() => expect(summary.result.current.isSuccess).toBe(true));
    expect(lastRequest()).toMatchObject({
      url: '/ledgers/ledger-1/settlement-summary',
      method: 'GET',
    });
  });

  it('writes people and refreshes people, transactions and the summary', async () => {
    const create = renderHook(() => useCreateLedgerPerson('ledger-1'), { wrapper });
    await act(() => create.result.current.mutateAsync({ name: '阿美' }));
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/people',
      method: 'POST',
      body: { name: '阿美' },
    });

    const rename = renderHook(() => useRenameLedgerPerson('ledger-1'), { wrapper });
    await act(() =>
      rename.result.current.mutateAsync({ personId: 'p-1', input: { name: '小美' } }),
    );
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/people/p-1',
      method: 'PATCH',
      body: { name: '小美' },
    });

    const remove = renderHook(() => useDeleteLedgerPerson('ledger-1'), { wrapper });
    await act(() => remove.result.current.mutateAsync('p-1'));
    expect(lastRequest()).toMatchObject({
      url: '/ledgers/ledger-1/people/p-1',
      method: 'DELETE',
    });

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ['ledger-people', 'ledger-1'],
        ['transactions', 'ledger-1'],
        ['settlement-summary', 'ledger-1'],
      ]) as unknown,
    );
  });

  it('writes settlements by settlement id and refreshes transactions, summary and balances', async () => {
    const create = renderHook(() => useCreateSettlement('ledger-1'), { wrapper });
    const body = { toPersonId: 'p-me', amount: 205000, date: '2026-10-05', fromAccountId: 'acc-1' };
    await act(() => create.result.current.mutateAsync(body));
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/settlements',
      method: 'POST',
      body,
    });

    const update = renderHook(() => useUpdateSettlement('ledger-1'), { wrapper });
    await act(() =>
      update.result.current.mutateAsync({ settlementId: 'set-1', input: { amount: 100000 } }),
    );
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/settlements/set-1',
      method: 'PATCH',
      body: { amount: 100000 },
    });

    const remove = renderHook(() => useDeleteSettlement('ledger-1'), { wrapper });
    await act(() => remove.result.current.mutateAsync('set-1'));
    expect(lastRequest()).toMatchObject({
      url: '/ledgers/ledger-1/settlements/set-1',
      method: 'DELETE',
    });

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ['transactions', 'ledger-1'],
        ['settlement-summary', 'ledger-1'],
        ['accounts'],
        COUNTERPARTIES_KEY,
        LEDGER_GROUPS_KEY,
      ]) as unknown,
    );
  });

  it('fills a pending account through the dedicated PUT endpoints', async () => {
    const transaction = renderHook(() => useSetTransactionAccount('ledger-1'), { wrapper });
    await act(() =>
      transaction.result.current.mutateAsync({
        transactionId: 'txn-1',
        input: { accountId: 'acc-1' },
      }),
    );
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/transactions/txn-1/account',
      method: 'PUT',
      body: { accountId: 'acc-1' },
    });

    const settlement = renderHook(() => useSetSettlementAccount('ledger-1'), { wrapper });
    await act(() =>
      settlement.result.current.mutateAsync({
        settlementId: 'set-1',
        input: { accountId: 'acc-1' },
      }),
    );
    expect(lastRequest()).toEqual({
      url: '/ledgers/ledger-1/settlements/set-1/account',
      method: 'PUT',
      body: { accountId: 'acc-1' },
    });

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ['transactions', 'ledger-1'],
        ['settlement-summary', 'ledger-1'],
        ['accounts'],
        COUNTERPARTIES_KEY,
        LEDGER_GROUPS_KEY,
      ]) as unknown,
    );
  });
});
