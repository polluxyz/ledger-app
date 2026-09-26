import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeDialog } from './MergeDialog';

/** 合併視窗只列未連動對象，並把選擇交給合併 API。 */
describe('MergeDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const counterparties = [
    {
      id: 'cp-unlinked',
      name: '舊名字',
      displayName: '小明',
      askMerge: false,
      balance: 30,
      link: null,
    },
    {
      id: 'cp-linked',
      name: null,
      displayName: '王小明',
      askMerge: false,
      balance: 10,
      link: { userId: 'user-1', userName: '王小明', theirBalance: -10 },
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation((url: string) => {
      const body = url.includes('/counterparties?')
        ? { items: counterparties, page: 1, limit: 100, total: counterparties.length }
        : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog() {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MergeDialog open counterpartyId="cp-linked" onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('lists only unlinked people and disables merge before a selection', async () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: '合併之前的紀錄' });
    const candidate = await within(dialog).findByRole('option', { name: '小明' });
    const select = within(dialog).getByLabelText('併入');

    expect(select).toHaveDisplayValue('');
    expect(candidate).toHaveValue('cp-unlinked');
    expect(within(select).queryByRole('option', { name: '王小明' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '合併' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\?limit=100$/),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('posts the selected source id and closes after success', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: '合併之前的紀錄' });

    await within(dialog).findByRole('option', { name: '小明' });
    await user.selectOptions(within(dialog).getByLabelText('併入'), 'cp-unlinked');
    await user.click(within(dialog).getByRole('button', { name: '合併' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\/cp-linked\/merge$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sourceId: 'cp-unlinked' }),
      }),
    );
  });
});
