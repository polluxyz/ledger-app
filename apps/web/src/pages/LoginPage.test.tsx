import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 登入流程的整合測試：從真實的 App（含路由與 Provider）出發，只把 fetch 換成
 * mock，因此驗證到的是使用者實際會經歷的流程，而非拆散的元件。
 */
describe('LoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/login');
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

  it('signs in and lands on the home page', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: 'jwt-abc' }));

    render(<App />);

    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: '登入' }));

    // 登入成功 → 導向首頁（首頁的登出按鈕出現）。
    expect(await screen.findByRole('button', { name: '登出' })).toBeInTheDocument();
    expect(localStorage.getItem('ledger.accessToken')).toBe('jwt-abc');
  });

  it('shows the backend message when the credentials are wrong', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        statusCode: 401,
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      }),
    );

    render(<App />);

    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    // 失敗時不得留下 token，畫面也應停在登入頁。
    expect(localStorage.getItem('ledger.accessToken')).toBeNull();
    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
  });

  it('explains a network failure without leaking internals', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);

    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('無法連線到伺服器');
  });
});
