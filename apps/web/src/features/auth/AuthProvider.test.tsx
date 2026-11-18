import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../../app/ProtectedRoute';
import { homeLayoutEditStore } from '../../app/home-layout-edit-store';
import { apiRequest } from '../../lib/api-client';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './use-auth';

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={logout}>登出</button>;
}

function setupSession() {
  localStorage.setItem('ledger.accessToken', 'clicked-token');
  localStorage.setItem('ledger.activeLedgerId', 'ledger');
  const layout = { version: 1 as const, bands: [] };
  homeLayoutEditStore.activateUser('user');
  homeLayoutEditStore.startEditing('user', 0, null, layout);
  const client = new QueryClient();
  client.setQueryData(['private'], 'private data');
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

function expectCleared(client: QueryClient) {
  expect(localStorage.getItem('ledger.accessToken')).toBeNull();
  expect(localStorage.getItem('ledger.activeLedgerId')).toBeNull();
  expect(homeLayoutEditStore.getSnapshot('user')).toBeNull();
  expect(client.getQueryData(['private'])).toBeUndefined();
}

/** 模擬受保護頁面收到 401，檢查登入狀態與路由是否同步。 */
describe('AuthProvider', () => {
  afterEach(() => {
    homeLayoutEditStore.clearAll();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([204, 500])('clears the session after logout returns %s', async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);
    const client = setupSession();
    await act(async () => {
      screen.getByRole('button', { name: '登出' }).click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({ Authorization: 'Bearer clicked-token' });
    expectCleared(client);
  });

  it('aborts after five seconds and ignores repeated clicks', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = setupSession();
    act(() => {
      screen.getByRole('button', { name: '登出' }).click();
      screen.getByRole('button', { name: '登出' }).click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ Authorization: 'Bearer clicked-token' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expectCleared(client);
  });

  it('does not clear a new token when logout responds late', async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    setupSession();
    act(() => {
      screen.getByRole('button', { name: '登出' }).click();
    });
    localStorage.setItem('ledger.accessToken', 'new-token');
    await act(async () => {
      resolveResponse(new Response(null, { status: 401 }));
      await Promise.resolve();
    });
    expect(localStorage.getItem('ledger.accessToken')).toBe('new-token');
  });

  it('returns to login when an authenticated request receives 401', async () => {
    localStorage.setItem('ledger.accessToken', 'expired');
    localStorage.setItem('ledger.activeLedgerId', 'ledger');
    const layout = { version: 1 as const, bands: [] };
    homeLayoutEditStore.activateUser('user');
    homeLayoutEditStore.startEditing('user', 0, null, layout);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private'], 'private data');
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/protected']}>
            <Routes>
              <Route path="/login" element={<p>登入頁</p>} />
              <Route element={<ProtectedRoute />}>
                <Route path="/protected" element={<p>已登入</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('已登入')).toBeInTheDocument();
    await act(async () => {
      await apiRequest('/users/me').catch(() => {});
    });
    expect(screen.getByText('登入頁')).toBeInTheDocument();
    expect(queryClient.getQueryData(['private'])).toBeUndefined();
    expectCleared(queryClient);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('/users/me');
  });
});
