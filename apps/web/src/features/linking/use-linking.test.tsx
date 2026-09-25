import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAcceptInviteLink,
  useAcceptLinkInvite,
  useAcceptProposal,
  useCancelLinkInvite,
  useDeclineLinkInvite,
  useDeclineProposal,
  useIncomingLinkInvites,
  useIncomingProposals,
  useInvitePreview,
  useOutgoingLinkInvite,
} from './use-linking';

/**
 * 連動 hooks 的三件事：**打對端點**（路徑、方法、body），**只做查找不做推導**（`forLink`、
 * `counterpartyId` 的篩選），以及**寫入後的快取失效**。
 *
 * 策略：fetch 換成 mock，依網址回固定資料；`invalidateQueries` 用 spy 觀察。
 */
describe('Linking hooks', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const linkInvite = { id: 'fr-1', forLink: true, counterpartyId: 'cp-1' };
  const plainInvite = { id: 'fr-2', forLink: false, counterpartyId: null };
  const otherLinkInvite = { id: 'fr-3', forLink: true, counterpartyId: 'cp-9' };

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
      if (url.includes('/friend-requests?')) {
        return json({
          items: [plainInvite, linkInvite, otherLinkInvite],
          page: 1,
          limit: 20,
          total: 3,
        });
      }
      if (url.includes('/counterparties?')) {
        return json({
          items: [
            { id: 'cp-other', name: '王小明二號' },
            { id: 'cp-new', name: '王小明' },
          ],
          page: 1,
          limit: 100,
          total: 2,
        });
      }
      return json({ id: 'x', counterpartyId: 'cp-from-link', items: [] });
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

  it('lists only incoming link invites, dropping plain ones', async () => {
    const { result } = renderHook(() => useIncomingLinkInvites(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(requests()[0]!.url).toMatch(
      /\/friend-requests\?direction=incoming&status=PENDING&limit=20$/,
    );
    expect(result.current.data?.map((request) => request.id)).toEqual(['fr-1', 'fr-3']);
  });

  it('lists incoming pending proposals', async () => {
    renderHook(() => useIncomingProposals(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requests()[0]!.url).toMatch(
      /\/debt-proposals\?direction=incoming&status=PENDING&limit=20$/,
    );
  });

  it('finds the sent link invite of one counterparty, or null', async () => {
    const found = renderHook(() => useOutgoingLinkInvite('cp-1'), { wrapper });
    await waitFor(() => expect(found.result.current.data).toBeDefined());
    expect(requests()[0]!.url).toMatch(/\/friend-requests\?direction=outgoing&status=PENDING/);
    expect(found.result.current.data?.id).toBe('fr-1');

    const none = renderHook(() => useOutgoingLinkInvite('cp-without-invite'), { wrapper });
    await waitFor(() => expect(none.result.current.data).toBeNull());
  });

  it('does not ask for sent invites before a counterparty is chosen', () => {
    renderHook(() => useOutgoingLinkInvite(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a link invite onto an existing counterparty and returns its id', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAcceptLinkInvite(), { wrapper });
    const accepted = await act(() =>
      result.current.mutateAsync({ requestId: 'fr-1', counterparty: { id: 'cp-5' } }),
    );
    expect(accepted).toEqual({ counterpartyId: 'cp-5' });
    expect(requests()).toEqual([
      {
        url: expect.stringMatching(/\/friend-requests\/fr-1\/accept$/) as unknown,
        method: 'POST',
        body: { counterparty: { id: 'cp-5' } },
      },
    ]);
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining(EVERYTHING) as unknown);
  });

  it('accepts a link invite with a new name and looks up the exact name afterwards', async () => {
    const { result } = renderHook(() => useAcceptLinkInvite(), { wrapper });
    const accepted = await act(() =>
      result.current.mutateAsync({ requestId: 'fr-1', counterparty: { name: ' 王小明 ' } }),
    );
    // 「王小明二號」也符合 q，但只有完全同名的才是剛接上的那位。
    expect(accepted).toEqual({ counterpartyId: 'cp-new' });
    expect(requests()[1]!.url).toMatch(
      /\/counterparties\?q=%E7%8E%8B%E5%B0%8F%E6%98%8E&limit=100$/,
    );
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

  it('accepts an invite link with or without a counterparty choice', async () => {
    const { result } = renderHook(() => useAcceptInviteLink(), { wrapper });
    const accepted = await act(() =>
      result.current.mutateAsync({ token: 't', counterparty: { name: '王小明' } }),
    );
    expect(accepted.counterpartyId).toBe('cp-from-link');
    expect(requests()[0]!.body).toEqual({ token: 't', counterparty: { name: '王小明' } });

    await act(() => result.current.mutateAsync({ token: 't' }));
    expect(requests()[1]!.body).toEqual({ token: 't' });
  });
});
