import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 受保護路由的整合測試：從真實的 App（含路由與 Provider）出發，只把 fetch
 * 換成 mock，驗證的是使用者實際會經歷的轉址流程。
 *
 * 除了「有沒有擋下來」，也驗**登入後會不會被送去站外**——那是這一步真正的
 * 安全性重點（`toSafeRedirect` 的單元測試在 lib/safe-redirect.test.ts）。
 */
describe('ProtectedRoute', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('sends a signed-out visitor to the login page', () => {
    window.history.pushState({}, '', '/accounts');

    render(<App />);

    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '帳戶' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('lets a signed-in visitor through', () => {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/accounts');

    render(<App />);

    expect(screen.getByRole('heading', { name: '帳戶' })).toBeInTheDocument();
  });

  it('returns the visitor to the page they were trying to reach', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: 'jwt-abc' }));
    window.history.pushState({}, '', '/accounts');

    render(<App />);

    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/accounts');
  });

  it('never follows an off-site destination planted in the router state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: 'jwt-abc' }));
    // 模擬有人把外部網址塞進 state：使用者在我們的網域登入，成功後應該留在站內。
    window.history.pushState({ usr: { from: '//evil.example' } }, '', '/login');

    render(<App />);

    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(await screen.findByRole('button', { name: '登出' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
