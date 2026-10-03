import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@ledger/shared';
import { CategoryDialog } from './CategoryDialog';

/**
 * 分類表單驗證圖示格的選取狀態，以及新增／更新都將代號送入 API。
 * 請求透過 hook 的 mock fetch 攔截，不需要啟動後端。
 */
describe('CategoryDialog', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const category: Category = {
    id: 'cat-food',
    name: '餐飲',
    type: 'EXPENSE',
    icon: 'food',
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-test');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ ...category, icon: null }), {
          status: init?.method === 'POST' ? 201 : 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog(target: Category | { type: 'EXPENSE' }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <CategoryDialog ledgerId="ledger-1" target={target} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('creates a category with the selected icon, defaulting to the generic icon', async () => {
    const user = userEvent.setup();
    renderDialog({ type: 'EXPENSE' });

    expect(screen.getByRole('button', { name: '通用' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: '圖示' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'coffee' }));
    await user.type(screen.getByLabelText('名稱'), '咖啡');
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      name: '咖啡',
      type: 'EXPENSE',
      icon: 'coffee',
    });
  });

  it('updates a category icon and sends null to restore the generic icon', async () => {
    const user = userEvent.setup();
    renderDialog(category);

    expect(screen.getByRole('button', { name: 'food' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '通用' }));
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ name: '餐飲', icon: null });
  });
});
