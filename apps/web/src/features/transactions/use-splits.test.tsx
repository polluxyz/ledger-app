import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateSplit, useDeleteSplit, useSplit, useUpdateSplit } from './use-splits';

/** 分帳 hooks 只負責 API 契約與快取更新；所有網路回應都用 mock，避免依賴後端版本。 */
describe('Split hooks', () => {
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
          : new Response(JSON.stringify({ id: 'split-1', split: { id: 'split-1' } }), {
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

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  }

  function expectRelatedQueriesInvalidated() {
    const keys = (invalidate.mock.calls as unknown as Array<[{ queryKey: unknown }]>).map(
      ([filters]) => filters.queryKey,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        ['splits'],
        ['transactions'],
        ['counterparties'],
        ['accounts'],
        ['debt-proposals'],
      ]) as unknown,
    );
  }

  type MutationHook = () => { mutateAsync: (input: unknown) => Promise<unknown> };
  interface MutationCase {
    name: string;
    hook: unknown;
    variables: unknown;
    method: string;
    path: RegExp;
  }

  it('reads one split by id', async () => {
    const { result } = renderHook(() => useSplit('split-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(lastRequest().url).toMatch(/\/splits\/split-1$/);
  });

  const mutationCases: MutationCase[] = [
    {
      name: 'creates',
      hook: useCreateSplit,
      variables: { type: 'EXPENSE', ledgerId: 'ledger-1', total: 300000, participants: [] },
      method: 'POST',
      path: /\/splits$/,
    },
    {
      name: 'updates',
      hook: useUpdateSplit,
      variables: { splitId: 'split-1', input: { type: 'INCOME', total: 9000 } },
      method: 'PATCH',
      path: /\/splits\/split-1$/,
    },
    {
      name: 'deletes',
      hook: useDeleteSplit,
      variables: 'split-1',
      method: 'DELETE',
      path: /\/splits\/split-1$/,
    },
  ];

  it.each(mutationCases)(
    '$name the split at the matching endpoint and refreshes dependent data',
    async ({ hook, variables, method, path }) => {
      invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const useMutationHook = hook as MutationHook;
      const { result } = renderHook(() => useMutationHook(), { wrapper });

      await act(() => result.current.mutateAsync(variables));

      expect(lastRequest().method).toBe(method);
      expect(lastRequest().url).toMatch(path);
      if (typeof variables === 'object' && variables !== null && 'input' in variables) {
        expect(lastRequest().body).toEqual(variables.input);
      } else if (method === 'POST') {
        expect(lastRequest().body).toEqual(variables);
      }
      expectRelatedQueriesInvalidated();
    },
  );
});
