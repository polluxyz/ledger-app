import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NicknameDialog } from './NicknameDialog';

/** 暱稱視窗只送修剪後的名字或 null，並維持規格列出的極簡文字。 */
describe('NicknameDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(name: string | null = '小明') {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <NicknameDialog open counterpartyId="cp-linked" name={name} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('shows only the title, nickname field, and two action labels', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '設定暱稱' });

    expect(within(dialog).getByRole('heading', { name: '設定暱稱' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('暱稱')).toHaveValue('小明');
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '儲存' })).toBeInTheDocument();
    expect(dialog.querySelectorAll('p')).toHaveLength(0);
  });

  it('trims the nickname and patches the counterparty', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: '設定暱稱' });

    await user.clear(within(dialog).getByLabelText('暱稱'));
    await user.type(within(dialog).getByLabelText('暱稱'), '  小明  ');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\/cp-linked$/),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '小明' }) }),
    );
  });

  it('sends null when the nickname is cleared', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '設定暱稱' });

    await user.clear(within(dialog).getByLabelText('暱稱'));
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\/cp-linked$/),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: null }) }),
    );
  });
});
