import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../features/auth/auth-context';
import InvitePage from './InvitePage';

/**
 * 邀請頁的 suite 走真實路由、表單與 linking hooks，只把 fetch 換成固定回應；
 * 因此可同時確認畫面狀態與 token 是否只進入正確的請求本文。
 */
describe('InvitePage', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let previewStatus: number;
  let previewBody: unknown;
  let acceptBody: unknown;
  let counterparties: unknown[];
  let holdPreview: boolean;
  let releasePreview: ((response: Response) => void) | null;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    previewStatus = 200;
    previewBody = {
      inviterName: '王小明',
      expiresAt: '2026-09-25T14:32:00.000Z',
    };
    acceptBody = {
      counterpartyId: 'cp-linked',
      askMerge: false,
      otherUser: { id: 'user-2', name: '王小明' },
    };
    counterparties = [];
    holdPreview = false;
    releasePreview = null;

    fetchMock.mockImplementation((input, init) => {
      const url = requestUrl(input);
      if (url.endsWith('/friend-invite-links/preview')) {
        if (holdPreview) {
          return new Promise<Response>((resolve) => {
            releasePreview = resolve;
          });
        }
        return Promise.resolve(jsonResponse(previewStatus, previewBody));
      }
      if (url.endsWith('/friend-invite-links/accept')) {
        return Promise.resolve(jsonResponse(200, acceptBody));
      }
      if (url.includes('/counterparties?')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: counterparties,
            page: 1,
            limit: 50,
            total: counterparties.length,
          }),
        );
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? 'GET'}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderInvite({
    path = '/invite#invite-token',
    authenticated = false,
  }: { path?: string; authenticated?: boolean } = {}) {
    window.history.replaceState(null, '', path);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <TestAuthProvider initiallyAuthenticated={authenticated}>
          <BrowserRouter>
            <Routes>
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/" element={<p>總覽目的地</p>} />
              <Route path="/counterparties" element={<CounterpartyDestination />} />
            </Routes>
          </BrowserRouter>
        </TestAuthProvider>
      </QueryClientProvider>,
    );
  }

  function requests() {
    return (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>).map(
      ([input, init]) => ({
        url: requestUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      }),
    );
  }

  function accepts() {
    return requests().filter((request) => request.url.endsWith('/friend-invite-links/accept'));
  }

  it('沒有 token 時提示連結無效或已過期，並且不發請求', () => {
    renderInvite({ path: '/invite', authenticated: true });

    expect(screen.getByRole('heading', { name: '連結無效或已過期' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到總覽' })).toHaveAttribute('href', '/');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未登入時只顯示登入與註冊入口', () => {
    renderInvite();

    expect(screen.getByText('登入後查看邀請')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '註冊' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('預覽請求載入時顯示載入狀態', () => {
    holdPreview = true;
    renderInvite({ authenticated: true });

    expect(screen.getByText('載入中…')).toBeInTheDocument();
    expect(releasePreview).not.toBeNull();
  });

  it('登入後在原頁自動預覽，hash 保留，token 只放在本文', async () => {
    const user = userEvent.setup();
    renderInvite({ path: '/invite#invite%20token' });

    await user.click(screen.getByRole('button', { name: '登入' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '登入' }));

    expect(
      await screen.findByRole('heading', { name: '王小明 邀請你連動往來帳' }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#invite%20token');
    const previewRequest = requests().find((request) =>
      request.url.endsWith('/friend-invite-links/preview'),
    );
    expect(previewRequest?.method).toBe('POST');
    expect(previewRequest?.url).not.toContain('invite token');
    expect(previewRequest?.url).not.toContain('invite%20token');
    expect(previewRequest?.body).toEqual({ token: 'invite token' });
  });

  it('預覽只顯示標題與拒絕、接受按鈕', async () => {
    renderInvite({ authenticated: true });

    expect(
      await screen.findByRole('heading', { name: '王小明 邀請你連動往來帳' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/同步|連結有效到/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '拒絕',
      '接受',
    ]);
  });

  it('接受不需詢問的連動邀請時本文只有 token、清除 hash 後開啟對象頁', async () => {
    const user = userEvent.setup();
    renderInvite({ authenticated: true });

    await user.click(await screen.findByRole('button', { name: '接受' }));

    expect(await screen.findByTestId('destination')).toHaveTextContent('/counterparties');
    expect(screen.getByTestId('opened-counterparty')).toHaveTextContent('cp-linked');
    expect(window.location.hash).toBe('');
    expect(accepts()).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: { token: 'invite-token' },
      }),
    ]);
  });

  it('接受後要詢問時先留在本頁，關閉詢問後開啟對象頁', async () => {
    const user = userEvent.setup();
    acceptBody = {
      counterpartyId: 'cp-linked',
      askMerge: true,
      otherUser: { id: 'user-2', name: '王小明' },
    };
    renderInvite({ authenticated: true });

    await screen.findByRole('heading', { name: '王小明 邀請你連動往來帳' });
    await user.click(screen.getByRole('button', { name: '接受' }));

    const dialog = await screen.findByRole('dialog', { name: '已和 王小明 連動' });
    expect(window.location.pathname).toBe('/invite');
    expect(window.location.hash).toBe('');
    expect(accepts()[0]?.body).toEqual({ token: 'invite-token' });
    await user.click(within(dialog).getByRole('button', { name: '稍後' }));
    expect(await screen.findByTestId('destination')).toHaveTextContent('/counterparties');
    expect(screen.getByTestId('opened-counterparty')).toHaveTextContent('cp-linked');
  });

  it('拒絕只導回總覽，不新增接受或拒絕請求', async () => {
    const user = userEvent.setup();
    renderInvite({ authenticated: true });
    await screen.findByRole('heading', { name: '王小明 邀請你連動往來帳' });
    const requestCountBeforeDecline = requests().length;

    await user.click(screen.getByRole('button', { name: '拒絕' }));

    expect(await screen.findByText('總覽目的地')).toBeInTheDocument();
    expect(requests()).toHaveLength(requestCountBeforeDecline);
    expect(accepts()).toHaveLength(0);
  });

  it('預覽回報邀請無效時只顯示無效狀態與回總覽', async () => {
    previewStatus = 404;
    previewBody = {
      statusCode: 404,
      errorCode: 'INVITE_LINK_INVALID',
      message: 'invalid invite',
    };
    renderInvite({ authenticated: true });

    expect(await screen.findByRole('heading', { name: '連結無效或已過期' })).toBeInTheDocument();
    expect(screen.queryByText(/重新產生|無效或已過期，/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到總覽' })).toHaveAttribute('href', '/');
  });

  it('token 格式不對（400）也當成無效連結，不顯示驗證訊息原文', async () => {
    previewStatus = 400;
    previewBody = {
      statusCode: 400,
      errorCode: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: ['token must match /^[A-Za-z0-9_-]{43}$/ regular expression'],
    };
    renderInvite({ authenticated: true });

    expect(await screen.findByRole('heading', { name: '連結無效或已過期' })).toBeInTheDocument();
    expect(screen.queryByText(/regular expression/)).not.toBeInTheDocument();
  });

  it('其他預覽錯誤保留表單錯誤與回總覽連結', async () => {
    previewStatus = 500;
    previewBody = {
      statusCode: 500,
      errorCode: 'SERVER_FAILURE',
      message: 'The service is unavailable.',
    };
    renderInvite({ authenticated: true });

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable.');
    expect(screen.getByRole('link', { name: '回到總覽' })).toHaveAttribute('href', '/');
  });

  it('接受失敗時在卡片內顯示錯誤並留在邀請頁', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/friend-invite-links/preview')) {
        return Promise.resolve(jsonResponse(200, previewBody));
      }
      if (url.endsWith('/friend-invite-links/accept')) {
        return Promise.resolve(
          jsonResponse(409, {
            statusCode: 409,
            errorCode: 'COUNTERPARTY_NAME_TAKEN',
            message: 'name already exists',
          }),
        );
      }
      if (url.includes('/counterparties?')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 50, total: 0 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderInvite({ authenticated: true });

    await user.click(await screen.findByRole('button', { name: '接受' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/invite');
    expect(screen.getByRole('button', { name: '接受' })).toBeInTheDocument();
  });
});

function TestAuthProvider({
  initiallyAuthenticated,
  children,
}: {
  initiallyAuthenticated: boolean;
  children: ReactNode;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(initiallyAuthenticated);
  const value: AuthContextValue = {
    token: isAuthenticated ? 'test-session' : null,
    isAuthenticated,
    login: () => {
      setIsAuthenticated(true);
      return Promise.resolve();
    },
    register: () => {
      setIsAuthenticated(true);
      return Promise.resolve();
    },
    logout: () => setIsAuthenticated(false),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function CounterpartyDestination() {
  const location = useLocation();
  const counterpartyId = (location.state as { openCounterpartyId?: string } | null)
    ?.openCounterpartyId;

  return (
    <>
      <p data-testid="destination">{location.pathname + location.search}</p>
      <p data-testid="opened-counterparty">{counterpartyId ?? 'none'}</p>
    </>
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}
