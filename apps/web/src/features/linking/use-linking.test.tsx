import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAcceptInviteLink,
  useAcceptLinkInvite,
  useAcceptProposal,
  useCancelLinkInvite,
  useCreateInviteLink,
  useDeclineLinkInvite,
  useDeclineProposal,
  useIncomingLinkInvites,
  useIncomingProposals,
  useInvitePreview,
  useMergePrompts,
  useOutgoingInvites,
  useSendLinkInvite,
} from './use-linking';

/**
 * 連動 hooks 的兩件事：**打對端點**（路徑、方法、body），以及**寫入後的快取失效**。
 *
 * 3b-2 修訂 1 起邀請不綁人、接受不帶 body（決策 73、74），這裡特別釘住「接受時沒有送出任何
 * 選人的欄位」與「產生連結不帶對象」。
 *
 * 策略：fetch 換成 mock，依網址回固定資料；`invalidateQueries` 用 spy 觀察。
 */
describe('Linking hooks', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const accepted = {
    counterpartyId: 'cp-new',
    askMerge: true,
    otherUser: { id: 'u-a', name: '甲' },
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/friend-requests?') || url.includes('/counterparties?')) {
        return json({ items: [{ id: 'row-1' }], page: 1, limit: 20, total: 1 });
      }
      if (url.endsWith('/accept')) {
        return json(accepted);
      }
      return json({ id: 'x', token: 't', expiresAt: '2026-09-26T06:32:00.000Z' });
    });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  function requests() {
    return (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).map(
      ([url, init]) => ({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      }),
    );
  }

  function invalidatedKeys(spy: { mock: { calls: unknown[] } }): unknown[] {
    const calls = spy.mock.calls as Array<[{ queryKey: unknown }]>;
    return calls.map(([filters]) => filters.queryKey);
  }

  const EVERYTHING = [
    ['friend-requests'],
    ['debt-proposals'],
    ['counterparties'],
    ['transactions'],
    ['accounts'],
  ];

  it.each([
    {
      name: 'incoming link invites',
      hook: useIncomingLinkInvites,
      url: /\/friend-requests\?direction=incoming&status=PENDING&limit=20$/,
    },
    {
      name: 'sent invites',
      hook: useOutgoingInvites,
      url: /\/friend-requests\?direction=outgoing&status=PENDING&limit=100$/,
    },
    {
      name: 'merge prompts',
      hook: useMergePrompts,
      url: /\/counterparties\?askMerge=true&limit=100$/,
    },
  ])('lists $name as a plain array', async ({ hook, url }) => {
    const { result } = renderHook(
      () => (hook as () => { data: Array<{ id: string }> | undefined })(),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(requests()[0]!.url).toMatch(url);
    expect(result.current.data?.map((row) => row.id)).toEqual(['row-1']);
  });

  it('lists incoming pending proposals', async () => {
    renderHook(() => useIncomingProposals(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requests()[0]!.url).toMatch(
      /\/debt-proposals\?direction=incoming&status=PENDING&limit=20$/,
    );
  });

  it('sends a link invite by email only, without any counterparty', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSendLinkInvite(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'b@example.com' }));
    expect(requests()[0]).toMatchObject({ method: 'POST', body: { email: 'b@example.com' } });
    expect(requests()[0]!.url).toMatch(/\/friend-requests$/);
    expect(invalidatedKeys(spy)).toEqual([['friend-requests']]);
  });

  it('creates an invite link without a body and without touching any cache', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateInviteLink(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(requests()[0]).toMatchObject({ method: 'POST', body: undefined });
    expect(requests()[0]!.url).toMatch(/\/friend-invite-links$/);
    expect(invalidatedKeys(spy)).toEqual([]);
  });

  it('accepts a link invite without a body and returns whether to ask about merging', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptLinkInvite(), { wrapper });
    const response = await act(() => result.current.mutateAsync('fr-1'));
    expect(response).toEqual(accepted);
    expect(requests()).toEqual([
      {
        url: expect.stringMatching(/\/friend-requests\/fr-1\/accept$/) as unknown,
        method: 'POST',
        body: undefined,
      },
    ]);
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining(EVERYTHING) as unknown);
  });

  it.each([
    {
      name: 'decline link invite',
      hook: useDeclineLinkInvite,
      path: /\/friend-requests\/id-1\/decline$/,
    },
    {
      name: 'cancel link invite',
      hook: useCancelLinkInvite,
      path: /\/friend-requests\/id-1\/cancel$/,
    },
    {
      name: 'decline proposal',
      hook: useDeclineProposal,
      path: /\/debt-proposals\/id-1\/decline$/,
    },
  ])('$name posts to the right endpoint', async ({ hook, path }) => {
    // 三個 hook 的回應型別不同，這裡只關心打到哪裡。
    const { result } = renderHook(
      () => (hook as () => { mutateAsync: (id: string) => Promise<unknown> })(),
      { wrapper },
    );
    await act(() => result.current.mutateAsync('id-1'));
    expect(requests()[0]).toMatchObject({ method: 'POST' });
    expect(requests()[0]!.url).toMatch(path);
  });

  it('accepts a proposal with the record as given, including null', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptProposal(), { wrapper });
    await act(() => result.current.mutateAsync({ proposalId: 'p-1', input: { record: null } }));
    expect(requests()[0]).toMatchObject({ method: 'POST', body: { record: null } });
    expect(requests()[0]!.url).toMatch(/\/debt-proposals\/p-1\/accept$/);
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining(EVERYTHING) as unknown);
  });

  it('accepts a proposal that needs no record with an empty body', async () => {
    const { result } = renderHook(() => useAcceptProposal(), { wrapper });
    await act(() => result.current.mutateAsync({ proposalId: 'p-2' }));
    expect(requests()[0]!.body).toEqual({});
  });

  it('previews an invite with the token in the body, never in the URL', async () => {
    renderHook(() => useInvitePreview('secret-token'), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [request] = requests();
    expect(request!.url).toMatch(/\/friend-invite-links\/preview$/);
    expect(request!.url).not.toContain('secret-token');
    expect(request!.body).toEqual({ token: 'secret-token' });
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ),
    ).not.toContain('secret-token');
  });

  it('does not preview without a token', () => {
    renderHook(() => useInvitePreview(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an invite link with the token only', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptInviteLink(), { wrapper });
    const response = await act(() => result.current.mutateAsync('t'));
    expect(response).toEqual(accepted);
    expect(requests()[0]).toMatchObject({ method: 'POST', body: { token: 't' } });
    expect(requests()[0]!.url).toMatch(/\/friend-invite-links\/accept$/);
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining(EVERYTHING) as unknown);
  });
});
