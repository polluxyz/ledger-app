import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 首頁的登入彈窗：開啟、切換到註冊、關閉，以及登入成功後就地變成已登入狀態
 * （網址不變，使用者不會被跳走）。
 *
 * 查詢一律限縮在 dialog 之內。真實瀏覽器會讓 showModal() 背後的頁面 inert，
 * 但 jsdom 未實作，因此改用 within() 明確表達「這是彈窗裡的元素」。
 */
describe('AuthDialog on the home page', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
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

  const dialog = () => within(screen.getByRole('dialog'));

  it('opens the login form without leaving the page', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(dialog().getByLabelText('Email')).toBeInTheDocument();
    expect(dialog().getByLabelText('密碼')).toBeInTheDocument();
    // 關鍵：仍停在首頁，沒有轉址。
    expect(window.location.pathname).toBe('/');
  });

  it('opens straight into the register form from the register button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '註冊' }));

    expect(dialog().getByLabelText('名稱')).toBeInTheDocument();
  });

  it('switches between login and register inside the dialog', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));
    expect(dialog().queryByLabelText('名稱')).not.toBeInTheDocument();

    await user.click(dialog().getByRole('button', { name: '改用註冊' }));
    expect(dialog().getByLabelText('名稱')).toBeInTheDocument();
  });

  it('closes without signing in', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));
    await user.click(dialog().getByRole('button', { name: '關閉' }));

    // 彈窗整個卸載，不只是隱藏。
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // 仍是未登入的預覽狀態。
    expect(screen.getAllByText('$0')).toHaveLength(3);
  });

  it('discards what was typed when reopened', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));
    await user.type(dialog().getByLabelText('Email'), 'typo@example.com');
    await user.click(dialog().getByRole('button', { name: '關閉' }));
    await user.click(screen.getByRole('button', { name: '登入' }));

    expect(dialog().getByLabelText('Email')).toHaveValue('');
  });

  it('signs in and turns the same page into the signed-in view', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve(jsonResponse(200, { accessToken: 'jwt-abc' }));
      }
      // 登入後首頁會開始抓帳本。
      return Promise.resolve(jsonResponse(200, []));
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));
    await user.type(dialog().getByLabelText('Email'), 'alice@example.com');
    await user.type(dialog().getByLabelText('密碼'), 'sup3rsecret');
    await user.click(dialog().getByRole('button', { name: '登入' }));

    expect(await screen.findByRole('button', { name: '登出' })).toBeInTheDocument();
    // 彈窗已關閉，且網址從頭到尾沒變。
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('keeps the dialog open and shows the error when login fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        statusCode: 401,
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: '登入' }));
    await user.type(dialog().getByLabelText('Email'), 'alice@example.com');
    await user.type(dialog().getByLabelText('密碼'), 'wrong');
    await user.click(dialog().getByRole('button', { name: '登入' }));

    expect(await dialog().findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(dialog().getByLabelText('密碼')).toBeInTheDocument();
  });
});
