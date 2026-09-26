import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { AddCounterpartyDialog } from './AddCounterpartyDialog';

/**
 * 新增視窗透過 hook 寫入 API；測試同時驗證成功交接與撞名時留在視窗內顯示中文錯誤。
 */
describe('AddCounterpartyDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(onCreated = vi.fn(), onClose = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <AddCounterpartyDialog open onClose={onClose} onCreated={onCreated} />
      </QueryClientProvider>,
    );
    return { onCreated, onClose };
  }

  it('posts a trimmed name and returns the created counterparty', async () => {
    const created: Counterparty = {
      id: 'cp-new',
      name: '小華',
      displayName: '小華',
      askMerge: false,
      balance: 0,
      link: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: '新增一個人' });

    await user.type(within(dialog).getByLabelText('名字'), ' 小華 ');
    await user.click(within(dialog).getByRole('button', { name: '新增' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '小華' }) }),
    );
  });

  it('keeps the dialog open and shows the localized duplicate-name error on 409', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 409,
          errorCode: 'COUNTERPARTY_NAME_TAKEN',
          message: 'Counterparty name already exists',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: '新增一個人' });

    await user.type(within(dialog).getByLabelText('名字'), '小華');
    await user.click(within(dialog).getByRole('button', { name: '新增' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '已經有同名的對象了，換一個名字。',
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
