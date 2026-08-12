import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 註冊流程的整合測試，重點在「註冊成功後會自動登入」這個體驗，
 * 以及 email 重複時如實呈現後端的 409 訊息。
 */
describe('RegisterPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/register');
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

  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('名稱'), 'Alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('密碼'), 'sup3rsecret');
  }

  it('registers, signs in automatically, and lands on the home page', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { id: 'u1', email: 'alice@example.com' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'jwt-new' }));

    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '註冊' }));

    expect(await screen.findByRole('button', { name: '登出' })).toBeInTheDocument();
    expect(localStorage.getItem('ledger.accessToken')).toBe('jwt-new');
    // 兩次呼叫：先註冊，再以同一組帳密登入。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the conflict message when the email is taken', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        errorCode: 'EMAIL_ALREADY_EXISTS',
        message: 'Email is already registered.',
      }),
    );

    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '註冊' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email is already registered.');
    expect(localStorage.getItem('ledger.accessToken')).toBeNull();
  });

  it('lists field-level messages from a validation failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        statusCode: 400,
        errorCode: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: ['password must be longer than or equal to 8 characters'],
      }),
    );

    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '註冊' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'password must be longer than or equal to 8 characters',
    );
  });
});
