import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty, LedgerSummary, Transaction } from '@ledger/shared';
import { MemoryRouter } from 'react-router-dom';
import { DebtHistoryView } from './DebtHistoryView';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'u-1' } }),
}));

/**
 * 借還歷史子分頁測試（debts-tabs2）。
 * 驗證個人往來已還清紀錄（可修改、撤銷）、共享帳本結清紀錄（唯讀），
 * 以及無資料時的段落隱藏與「沒有歷史紀錄」提示。
 */
describe('DebtHistoryView', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const currentLedger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: false,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const sharedLedgerWithSettlement: LedgerSummary = {
    id: 'ledger-shared-1',
    name: '旅行帳本',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: false,
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const sharedLedgerWithoutSettlement: LedgerSummary = {
    id: 'ledger-shared-2',
    name: '家庭帳本',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: false,
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const counterpartyMing: Counterparty = {
    id: 'cp-ming',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    balance: 0,
    totalBalance: 0,
    ledgerParts: [],
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const settlementTxn: Transaction = {
    id: 'txn-settle-1',
    type: 'TRANSFER',
    amount: 10000,
    date: '2026-09-02T00:00:00.000Z',
    title: null,
    note: null,
    category: null,
    account: { id: 'acc-1', name: '現金' },
    toAccount: null,
    creator: { id: 'u-1', name: '我' },
    settlement: {
      id: 'set-1',
      from: { id: 'p-1', name: '小明', userId: 'u-2', status: 'MEMBER' },
      to: { id: 'p-2', name: '我', userId: 'u-1', status: 'MEMBER' },
    },
    debt: null,
    split: null,
    payer: null,
    ledgerSplit: null,
    accountPending: false,
    createdAt: '2026-09-02T00:00:00.000Z',
  };

  const mingEntries = [
    {
      id: 'entry-1',
      counterpartyId: 'cp-ming',
      kind: 'COLLECT' as const,
      delta: -5000,
      date: '2026-09-02T00:00:00.000Z',
      note: '還清',
      transactionId: 'txn-c1',
      splitId: null,
      settlesEntryId: null,
      balanceAfter: 0,
      sync: 'NONE' as const,
      paired: false,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
    {
      id: 'entry-2',
      counterpartyId: 'cp-ming',
      kind: 'LEND' as const,
      delta: 5000,
      date: '2026-09-01T00:00:00.000Z',
      note: '借款',
      transactionId: 'txn-l1',
      splitId: null,
      settlesEntryId: null,
      balanceAfter: 5000,
      sync: 'NONE' as const,
      paired: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderHistory(onEditSplit = vi.fn()) {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DebtHistoryView ledger={currentLedger} onEditSplit={onEditSplit} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('renders both sections, expands personal history with actions, and expands shared ledger settlements', async () => {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties?limit=100')) {
        return json({ items: [counterpartyMing], page: 1, limit: 100, total: 1 });
      }
      if (url.includes('/counterparties/cp-ming/entries')) {
        return json({ items: mingEntries, page: 1, limit: 100, total: 2 });
      }
      if (url.includes('/ledgers?includeArchived=true')) {
        return json([currentLedger, sharedLedgerWithSettlement, sharedLedgerWithoutSettlement]);
      }
      if (url.includes('/ledgers/ledger-shared-1/transactions')) {
        return json({ items: [settlementTxn], page: 1, limit: 100, total: 1 });
      }
      if (url.includes('/ledgers/ledger-shared-2/transactions')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      return json([]);
    });

    const user = userEvent.setup();
    renderHistory();

    expect(await screen.findByRole('heading', { name: '個人往來' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '共享帳本' })).toBeInTheDocument();

    // 個人列只有名字，沒有箭頭記號
    const mingRow = screen.getByRole('button', { name: '小明' });
    expect(mingRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/欠/)).not.toBeInTheDocument();

    // 共享帳本：只有有結清的帳本，沒有結清的不列出
    expect(screen.getByRole('button', { name: '旅行帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '家庭帳本' })).not.toBeInTheDocument();

    // 展開個人往來歷史：已還清紀錄的修改、撤銷收在「⋯」選單裡
    await user.click(mingRow);
    expect(mingRow).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('還清')).toBeInTheDocument();
    expect(screen.getByText('借款')).toBeInTheDocument();
    const menuTriggers = screen.getAllByRole('button', { name: '更多操作' });
    expect(menuTriggers).toHaveLength(2);
    await user.click(menuTriggers[0]!);
    expect(screen.getByRole('menuitem', { name: '修改' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '撤銷' })).toBeInTheDocument();

    // 展開共享帳本歷史：唯讀交易清單
    const sharedRow = screen.getByRole('button', { name: '旅行帳本' });
    await user.click(sharedRow);
    expect(sharedRow).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('結清')).toBeInTheDocument();
  });

  it('shows only personal section when no shared ledgers have settlements', async () => {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties?limit=100')) {
        return json({ items: [counterpartyMing], page: 1, limit: 100, total: 1 });
      }
      if (url.includes('/counterparties/cp-ming/entries')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/ledgers?includeArchived=true')) {
        return json([currentLedger, sharedLedgerWithoutSettlement]);
      }
      if (url.includes('/ledgers/ledger-shared-2/transactions')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      return json([]);
    });

    renderHistory();

    expect(await screen.findByRole('heading', { name: '個人往來' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '共享帳本' })).not.toBeInTheDocument();
    expect(screen.queryByText('沒有歷史紀錄。')).not.toBeInTheDocument();
  });

  it('shows only shared section when no personal counterparties exist', async () => {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties?limit=100')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/ledgers?includeArchived=true')) {
        return json([currentLedger, sharedLedgerWithSettlement]);
      }
      if (url.includes('/ledgers/ledger-shared-1/transactions')) {
        return json({ items: [settlementTxn], page: 1, limit: 100, total: 1 });
      }
      return json([]);
    });

    renderHistory();

    expect(await screen.findByRole('heading', { name: '共享帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '個人往來' })).not.toBeInTheDocument();
    expect(screen.queryByText('沒有歷史紀錄。')).not.toBeInTheDocument();
  });

  it('shows 沒有歷史紀錄 when both personal and shared have no data', async () => {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties?limit=100')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/ledgers?includeArchived=true')) {
        return json([currentLedger]);
      }
      return json([]);
    });

    renderHistory();

    expect(await screen.findByText('沒有歷史紀錄。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '個人往來' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '共享帳本' })).not.toBeInTheDocument();
  });

  it('shows 沒有歷史紀錄 when expanding a personal counterparty with no settled entries', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties?limit=100')) {
        return json({ items: [counterpartyMing], page: 1, limit: 100, total: 1 });
      }
      if (url.includes('/counterparties/cp-ming/entries')) {
        // 只有未還清紀錄，沒有歸零紀錄
        return json({
          items: [
            {
              id: 'entry-only-outstanding',
              counterpartyId: 'cp-ming',
              kind: 'LEND',
              delta: 5000,
              date: '2026-09-01T00:00:00.000Z',
              note: '借款',
              transactionId: 'txn-l1',
              splitId: null,
              settlesEntryId: null,
              balanceAfter: 5000,
              sync: 'NONE',
              paired: false,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 100,
          total: 1,
        });
      }
      if (url.includes('/ledgers?includeArchived=true')) {
        return json([currentLedger]);
      }
      return json([]);
    });

    renderHistory();

    const mingRow = await screen.findByRole('button', { name: '小明' });
    await user.click(mingRow);
    expect(await screen.findByText('沒有歷史紀錄。')).toBeInTheDocument();
  });
});
