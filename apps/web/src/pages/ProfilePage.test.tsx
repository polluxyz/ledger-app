import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../app/providers';
import ProfilePage from './ProfilePage';

/**
 * 個人資料頁：顯示 email 與顯示名稱、改名時只送 name 到 PATCH /users/me，
 * 以及後端退 400 時「錯誤要顯示、輸入不能清空」。
 *
 * 策略與其他頁面測試（LedgerDetailPage.test.tsx 等）同源：只把 fetch 換成 mock，
 * Provider 用真的。差別在這一頁尚未接進 routes.tsx（接路由與側邊欄是另一項
 * 工作），因此改為直接在 AppProviders 之下渲染頁面本體；頁面本身不用路由，
 * 也就不需要 Router。
 */
describe('ProfilePage', () => {
  const fetchMock = vi.fn();

  const alice = {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
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

  /** /users/me 的 GET / PATCH 分流；其他請求（如 Provider 抓的 /ledgers）回空清單。 */
  function routeFetch(overrides: { patch?: () => Promise<Response> } = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/users/me')) {
        if (init?.method === 'PATCH') {
          return overrides.patch?.() ?? Promise.resolve(jsonResponse(200, alice));
        }
        return Promise.resolve(jsonResponse(200, alice));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  function renderPage() {
    return render(
      <AppProviders>
        <ProfilePage />
      </AppProviders>,
    );
  }

  it('shows the current email and display name', async () => {
    routeFetch();

    renderPage();

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Email 不可變更')).toBeInTheDocument();
    expect(screen.getByLabelText('顯示名稱')).toHaveValue('Alice');
    // Email 是純文字，不是輸入框——做成輸入框會讓人以為之後能改。
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
  });

  it('sends only the new name to PATCH /users/me', async () => {
    routeFetch();
    const user = userEvent.setup();

    renderPage();

    const nameField = await screen.findByLabelText('顯示名稱');
    await user.clear(nameField);
    await user.type(nameField, '愛麗絲');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(String(patch?.[0])).toContain('/users/me');
      const body = (patch?.[1] as RequestInit | undefined)?.body;
      // 只送 name——多送任何欄位都會被後端的白名單退成 400。
      expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ name: '愛麗絲' });
    });
  });

  it('keeps the typed name and shows the backend error on a 400', async () => {
    routeFetch({
      patch: () =>
        Promise.resolve(
          jsonResponse(400, {
            statusCode: 400,
            errorCode: 'VALIDATION_FAILED',
            message: 'name must be longer than or equal to 1 characters',
          }),
        ),
    });
    const user = userEvent.setup();

    renderPage();

    const nameField = await screen.findByLabelText('顯示名稱');
    await user.clear(nameField);
    await user.type(nameField, '愛麗絲');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    // 後端的訊息由 FormError 原樣呈現，前端不改寫。
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'name must be longer than or equal to 1 characters',
    );
    // 使用者剛打的字不能消失。
    expect(screen.getByLabelText('顯示名稱')).toHaveValue('愛麗絲');
  });
});
