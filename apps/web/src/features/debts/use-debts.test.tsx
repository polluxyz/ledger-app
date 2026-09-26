import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCounterparties,
  useCounterpartyEntries,
  useCreateCounterparty,
  useCreateDebtEntry,
  useDismissMergePrompt,
  useDeleteCounterparty,
  useDeleteDebtEntry,
  useForgiveCounterparty,
  useRenameCounterparty,
  useMergeCounterparty,
  useUnlinkCounterparty,
  useUpdateDebtEntry,
} from './use-debts';

/**
 * 借還（往來帳版）hooks 的兩件事：**打對端點**（路徑、方法、body 原樣送出），以及**寫入後的快取
 * 失效**。
 *
 * 失效是這一檔的重點：往來寫入會同時改到對象與往來紀錄、任何一本帳本的交易列表與帳戶
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
      expect.arrayContaining([['counterparties'], ['transactions'], ['accounts']]) as unknown,
    );
  }

  it('lists counterparties and their entries with paging in the query string', async () => {
    renderHook(() => useCounterparties({ page: 2, limit: 20 }), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequest().url).toMatch(/\/counterparties\?page=2&limit=20$/);

    renderHook(() => useCounterpartyEntries('cp-1', { page: 1 }), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastRequest().url).toMatch(/\/counterparties\/cp-1\/entries\?page=1$/);
  });

  it.each([
    {
      name: 'create entry',
      hook: useCreateDebtEntry,
      variables: {
        counterparty: { name: '小明' },
        kind: 'COLLECT',
        amount: 90,
        date: 'd',
        record: null,
        settle: true,
      },
      method: 'POST',
      path: /\/debt-entries$/,
      // `record: null` 必須原樣送出，不能被當成「沒給」丟掉——後端會把省略當成 400。
      body: {
        counterparty: { name: '小明' },
        kind: 'COLLECT',
        amount: 90,
        date: 'd',
        record: null,
        settle: true,
      },
    },
    {
      name: 'update entry',
      hook: useUpdateDebtEntry,
      variables: { entryId: 'e-1', input: { note: null } },
      method: 'PATCH',
      path: /\/debt-entries\/e-1$/,
      body: { note: null },
    },
    {
      name: 'delete entry',
      hook: useDeleteDebtEntry,
      variables: 'e-1',
      method: 'DELETE',
      path: /\/debt-entries\/e-1$/,
    },
    {
      name: 'rename counterparty',
      hook: useRenameCounterparty,
      variables: { counterpartyId: 'cp-1', name: '明明' },
      method: 'PATCH',
      path: /\/counterparties\/cp-1$/,
      body: { name: '明明' },
    },
    {
      name: 'delete counterparty',
      hook: useDeleteCounterparty,
      variables: 'cp-1',
      method: 'DELETE',
      path: /\/counterparties\/cp-1$/,
    },
    {
      name: 'forgive',
      hook: useForgiveCounterparty,
      variables: 'cp-1',
      method: 'POST',
      path: /\/counterparties\/cp-1\/forgive$/,
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

  // 3b-2：這幾個只動到部分快取，所以各自釘住該失效的前綴，不套用上面那條「全部失效」。
  function invalidatedKeys(): unknown[] {
    const calls = invalidate.mock.calls as unknown as Array<[{ queryKey: unknown }]>;
    return calls.map(([filters]) => filters.queryKey);
  }

  it('filters counterparties by name with q', async () => {
    renderHook(() => useCounterparties({ q: '小 明', limit: 50 }), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequest().url).toMatch(/\/counterparties\?q=%E5%B0%8F\+%E6%98%8E&limit=50$/);
  });

  it('creates a counterparty without an entry and refreshes the list', async () => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCounterparty(), { wrapper });
    await act(() => result.current.mutateAsync({ name: '媽媽' }));
    expect(lastRequest()).toMatchObject({
      method: 'POST',
      body: { name: '媽媽' },
    });
    expect(lastRequest().url).toMatch(/\/counterparties$/);
    expect(invalidatedKeys()).toEqual([['counterparties']]);
  });

  it('clears a nickname by sending name: null as is', async () => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRenameCounterparty(), { wrapper });
    await act(() => result.current.mutateAsync({ counterpartyId: 'cp-1', name: null }));
    expect(lastRequest()).toMatchObject({ method: 'PATCH', body: { name: null } });
    expectEverythingInvalidated();
  });

  it('merges an unlinked counterparty into a linked one and refreshes everything', async () => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMergeCounterparty(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ counterpartyId: 'cp-linked', sourceId: 'cp-old' }),
    );
    expect(lastRequest()).toMatchObject({ method: 'POST', body: { sourceId: 'cp-old' } });
    expect(lastRequest().url).toMatch(/\/counterparties\/cp-linked\/merge$/);
    expectEverythingInvalidated();
  });

  it('dismisses the merge prompt and refreshes counterparties', async () => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDismissMergePrompt(), { wrapper });
    await act(() => result.current.mutateAsync('cp-linked'));
    expect(lastRequest()).toMatchObject({ method: 'DELETE' });
    expect(lastRequest().url).toMatch(/\/counterparties\/cp-linked\/merge-prompt$/);
    expect(invalidatedKeys()).toEqual([['counterparties']]);
  });

  it('unlinks and refreshes debts, transactions, accounts and everything pending', async () => {
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUnlinkCounterparty(), { wrapper });
    await act(() => result.current.mutateAsync('cp-1'));
    expect(lastRequest()).toMatchObject({ method: 'DELETE' });
    expect(lastRequest().url).toMatch(/\/counterparties\/cp-1\/link$/);
    expectEverythingInvalidated();
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([['friend-requests'], ['debt-proposals']]) as unknown,
    );
  });
});
