import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../../app/ProtectedRoute';
import { apiRequest } from '../../lib/api-client';
import { AuthProvider } from './AuthProvider';

/** 模擬受保護頁面收到 401，檢查登入狀態與路由是否同步。 */
describe('AuthProvider', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('returns to login when an authenticated request receives 401', async () => {
    localStorage.setItem('ledger.accessToken', 'expired');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
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
  });
});
