import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteLedgerDialog } from './DeleteLedgerDialog';

describe('DeleteLedgerDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const allowedPreview = {
    accounts: [{ accountId: 'acc-1', name: '現金', balance: 12000, balanceAfter: 3000 }],
    counterparties: [
      {
        counterpartyId: 'cp-1',
        displayName: '小明',
        linked: true,
        balance: 12000,
        balanceAfter: 0,
      },
    ],
    withdrawsDebts: true,
    delete: { allowed: true, blockedBy: null },
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function renderDialog(preview: unknown, onArchived = vi.fn()) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/ledgers/ledger-1/removal-preview')) {
        return Promise.resolve(jsonResponse(200, preview));
      }
      if (target.includes('/ledgers/ledger-1/archive') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { id: 'ledger-1' }));
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`未預期的請求：${target}`));
    });

    const onCancel = vi.fn();
    const onDeleted = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DeleteLedgerDialog
          ledgerId="ledger-1"
          ledgerName="家庭帳本"
          onCancel={onCancel}
          onDeleted={onDeleted}
          onArchived={onArchived}
        />
      </QueryClientProvider>,
    );
    return { onCancel, onDeleted, onArchived };
  }

  function renderSharedDialog(preview: unknown, onArchived = vi.fn()) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/ledgers') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(
          jsonResponse(200, [
            {
              id: 'personal-1',
              name: '日常',
              kind: 'PERSONAL',
              role: 'OWNER',
              archivedAt: null,
            },
          ]),
        );
      }
      if (target.endsWith('/ledgers/ledger-1/leave-preview')) {
        return Promise.resolve(jsonResponse(200, preview));
      }
      if (target.endsWith('/ledgers/ledger-1/leave') && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (target.endsWith('/ledgers/ledger-1/archive') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { id: 'ledger-1' }));
      }
      return Promise.reject(new Error(`未預期的請求：${target}`));
    });

    const onCancel = vi.fn();
    const onDeleted = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DeleteLedgerDialog
          ledgerId="ledger-1"
          ledgerName="家庭帳本"
          ledgerKind="SHARED"
          onCancel={onCancel}
          onDeleted={onDeleted}
          onArchived={onArchived}
        />
      </QueryClientProvider>,
    );
    return { onCancel, onDeleted, onArchived };
  }

  it('shows account and counterparty impacts and requires the exact ledger name before deleting', async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderDialog(allowedPreview);

    expect(await screen.findByRole('heading', { name: '刪除「家庭帳本」' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '往來' })).toBeInTheDocument();
    expect(screen.getByText('現金')).toBeInTheDocument();
    expect(screen.getByText('$120 → $30')).toBeInTheDocument();
    const counterparty = screen.getByText('小明').closest('li');
    expect(counterparty).not.toBeNull();
    expect(within(counterparty as HTMLElement).getByText('連動')).toBeInTheDocument();
    expect(within(counterparty as HTMLElement).getByText('兩清')).toBeInTheDocument();
    expect(within(counterparty as HTMLElement).getByTitle('小明')).toHaveTextContent('小');
    expect(within(counterparty as HTMLElement).getByTitle('我')).toHaveTextContent('我');

    const remove = screen.getByRole('button', { name: '刪除' });
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText('輸入帳本名稱'), '錯誤');
    expect(remove).toBeDisabled();
    await user.clear(screen.getByLabelText('輸入帳本名稱'));
    await user.type(screen.getByLabelText('輸入帳本名稱'), '家庭帳本');
    expect(remove).toBeEnabled();
    await user.click(remove);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'DELETE',
    );
    expect(request).toBeDefined();
    const deleteUrl = new URL(String(request?.[0]));
    expect(deleteUrl.searchParams.get('confirm')).toBe('家庭帳本');
    expect(deleteUrl.searchParams.get('withdrawDebts')).toBe('true');
  });

  it('omits the counterparty section when the preview only has accounts and sends no withdrawal flag', async () => {
    const user = userEvent.setup();
    renderDialog({
      ...allowedPreview,
      counterparties: [],
      withdrawsDebts: false,
    });

    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來' })).not.toBeInTheDocument();
    expect(screen.queryByText('小明')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('輸入帳本名稱'), '家庭帳本');
    await user.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'DELETE',
      );
      expect(request).toBeDefined();
      expect(new URL(String(request?.[0])).searchParams.has('withdrawDebts')).toBe(false);
    });
  });

  it.each([
    ['HAS_OTHERS_TRANSACTIONS', '有其他成員的交易，只能封存'],
    ['SHARED_HAS_DEBTS', '有借還或分帳，只能封存'],
  ] as const)(
    'shows the archive-only state for %s and archives without typing',
    async (blockedBy, reason) => {
      const user = userEvent.setup();
      const onArchived = vi.fn();
      renderDialog(
        {
          accounts: [],
          counterparties: [],
          withdrawsDebts: false,
          delete: { allowed: false, blockedBy },
        },
        onArchived,
      );

      expect(await screen.findByText(reason)).toBeInTheDocument();
      expect(screen.queryByLabelText('輸入帳本名稱')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '封存' }));

      await waitFor(() => expect(onArchived).toHaveBeenCalledOnce());
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/ledgers/ledger-1/archive') &&
            (init as RequestInit)?.method === 'POST',
        ),
      ).toBe(true);
    },
  );

  it('deletes the last-member shared ledger through the leave endpoint after typing its name', async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderSharedDialog({
      items: [
        {
          id: 'item-1',
          date: '2026-10-01T12:00:00.000Z',
          title: '住宿',
          categoryIcon: 'home',
          accountEffects: [],
          share: 1000,
          paidByName: null,
          kind: 'SHARED',
        },
      ],
      accounts: [{ accountId: 'account-1', name: '現金', balance: 5000, balanceAfter: 5000 }],
      carryOvers: [
        {
          ledgerPersonId: 'person-1',
          displayName: '小明',
          amount: 1200,
          counterpartyId: 'cp-1',
        },
      ],
      withdrawals: [],
      leave: { allowed: true, blockedBy: null },
    });

    expect(await screen.findByRole('heading', { name: '刪除「家庭帳本」' })).toBeInTheDocument();
    expect(await screen.findByText('現金')).toBeInTheDocument();
    expect(await screen.findByText('小明')).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: '刪除' });
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText('輸入帳本名稱'), '家庭帳本');
    await user.click(remove);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/ledgers/ledger-1/leave') && (init as RequestInit)?.method === 'POST',
    );
    expect(request).toBeDefined();
    const body = (request?.[1] as RequestInit | undefined)?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('預期 leave request 帶 JSON body');
    expect(JSON.parse(body)).toMatchObject({
      targetLedgerId: 'personal-1',
      excludedItemIds: [],
      deleteLedger: true,
      confirm: '家庭帳本',
    });
  });

  it('shows cancel and archive only when a shared ledger still has members', async () => {
    const user = userEvent.setup();
    const onArchived = vi.fn();
    renderSharedDialog(
      {
        items: [
          {
            id: 'item-1',
            date: '2026-10-01T12:00:00.000Z',
            title: '住宿',
            categoryIcon: 'home',
            accountEffects: [],
            share: 1000,
            paidByName: null,
            kind: 'SHARED',
          },
        ],
        accounts: [],
        carryOvers: [],
        withdrawals: [],
        leave: { allowed: false, blockedBy: 'HAS_OTHER_MEMBERS' },
      },
      onArchived,
    );

    expect(await screen.findByText('還有其他成員，只能封存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '封存' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('輸入帳本名稱')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '封存' }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledOnce());
  });
});
