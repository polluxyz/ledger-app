import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MergePromptDialog, MergePromptForm } from './MergePrompt';

/** 詢問表單依回答走合併或清除標記；「稍後」只通知呼叫端，不送 mutation。 */
describe('MergePromptForm', () => {
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

  function renderForm(onDone = vi.fn(), onLater = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <MergePromptForm counterpartyId="cp-linked" onDone={onDone} onLater={onLater} />
      </QueryClientProvider>,
    );
    return { onDone, onLater };
  }

  it('defaults to no and dismisses the prompt on confirmation', async () => {
    const user = userEvent.setup();
    const { onDone } = renderForm();

    expect(await screen.findByText('之前有用別的名字記過他嗎？')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '沒有' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '確定' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\/cp-linked\/merge-prompt$/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('merges the selected unlinked person when yes is chosen', async () => {
    const user = userEvent.setup();
    const { onDone } = renderForm();

    expect(await screen.findByRole('option', { name: '小明' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '有：' }));
    const select = screen.getByRole('combobox', { name: '未連動的人' });
    expect(select).toBeEnabled();
    await user.selectOptions(select, 'cp-unlinked');
    await user.click(screen.getByRole('button', { name: '確定' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties\/cp-linked\/merge$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sourceId: 'cp-unlinked' }),
      }),
    );
  });

  it('calls later without sending a mutation', async () => {
    const user = userEvent.setup();
    const { onDone, onLater } = renderForm();

    await screen.findByRole('radio', { name: '沒有' });
    await user.click(screen.getByRole('button', { name: '稍後' }));

    expect(onLater).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(([, options]) => (options as RequestInit).method === 'GET'),
    ).toBe(true);
  });

  it('still renders the question when there are no unlinked people', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ items: [counterparties[1]], page: 1, limit: 100, total: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    renderForm();

    expect(await screen.findByText('之前有用別的名字記過他嗎？')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: '有：' }));
    expect(screen.getByRole('button', { name: '確定' })).toBeDisabled();
  });
});

describe('MergePromptDialog', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 1, limit: 100, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the account name in the title', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDone = vi.fn();
    const onLater = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <MergePromptDialog
          open
          counterpartyId="cp-linked"
          userName="甲"
          onDone={onDone}
          onLater={onLater}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('dialog', { name: '已和 甲 連動' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByText('之前有用別的名字記過他嗎？'),
    ).toBeInTheDocument();
  });
});
