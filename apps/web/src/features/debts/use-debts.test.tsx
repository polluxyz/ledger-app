import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateDebt,
  useCreateDebtPayment,
  useDebts,
  useDeleteDebt,
  useDeleteDebtPayment,
  useForgiveDebt,
  useUpdateDebt,
} from './use-debts';

/**
 * 借還 hooks 的兩件事：**打對端點**（路徑、方法、body 原樣送出），以及**寫入後的快取
 * 失效**。
 *
 * 失效是這一檔的重點：債務寫入會同時改到債務、淨額、任何一本帳本的交易列表與帳戶
 * 餘額（見 `use-debts.ts` 檔頭）。少失效一個不會拋錯，只會讓某個畫面停在舊數字，
 * 所以每一個 mutation 都用同一條斷言釘住整組前綴。
 *
 * 策略：fetch 整個換成 mock，一律回成功；`invalidateQueries` 用 spy 觀察。
 */
describe('Debt hooks', () => {
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
          : new Response(JSON.stringify({ id: 'debt-1', items: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    );
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  /** 最後一次 fetch 的網址、方法與 body。 */
  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  }

  function expectEverythingInvalidated() {
    const calls = invalidate.mock.calls as unknown as Array<[{ queryKey: unknown }]>;
    const keys = calls.map(([filters]) => filters.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([['debts'], ['transactions'], ['accounts']]) as unknown,
    );
  }

  it('lists debts with the status filter and paging in the query string', async () => {
    renderHook(() => useDebts({ status: 'OPEN', page: 2, limit: 20 }), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequest().url).toMatch(/\/debts\?status=OPEN&page=2&limit=20$/);
  });

  it.each([
    {
      name: 'create',
      hook: useCreateDebt,
      variables: { direction: 'LENT', counterpartyName: '小明', principal: 5000, date: 'd' },
      method: 'POST',
      path: /\/debts$/,
    },
    {
      name: 'update',
      hook: useUpdateDebt,
      variables: { debtId: 'debt-1', input: { note: '改' } },
      method: 'PATCH',
      path: /\/debts\/debt-1$/,
      body: { note: '改' },
    },
    {
      name: 'delete',
      hook: useDeleteDebt,
      variables: 'debt-1',
      method: 'DELETE',
      path: /\/debts\/debt-1$/,
    },
    {
      name: 'create payment',
      hook: useCreateDebtPayment,
      variables: {
        debtId: 'debt-1',
        input: { amount: 90, date: 'd', record: null, settles: true },
      },
      method: 'POST',
      path: /\/debts\/debt-1\/payments$/,
      // `record: null` 必須原樣送出，不能被當成「沒給」丟掉（plan §2.4）。
      body: { amount: 90, date: 'd', record: null, settles: true },
    },
    {
      name: 'delete payment',
      hook: useDeleteDebtPayment,
      variables: { debtId: 'debt-1', paymentId: 'p-1' },
      method: 'DELETE',
      path: /\/debts\/debt-1\/payments\/p-1$/,
    },
    {
      name: 'forgive',
      hook: useForgiveDebt,
      variables: 'debt-1',
      method: 'POST',
      path: /\/debts\/debt-1\/forgive$/,
    },
  ])(
    '$name hits the right endpoint and invalidates debts, transactions and accounts',
    async ({ hook, variables, method, path, body }) => {
      invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      // 每個 hook 的 variables 形狀不同，這裡只關心它原樣被送出。
      const { result } = renderHook(
        () => (hook as () => { mutateAsync: (v: unknown) => Promise<unknown> })(),
        { wrapper },
      );

      await act(() => result.current.mutateAsync(variables));

      const request = lastRequest();
      expect(request.method).toBe(method);
      expect(request.url).toMatch(path);
      if (body !== undefined) {
        expect(request.body).toEqual(body);
      }
      expectEverythingInvalidated();
    },
  );
});
