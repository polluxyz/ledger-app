import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionDraft } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { AiDraftList, type AiDraftItem } from './AiDraftList';

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return { ...actual, apiRequest: vi.fn() };
});

const requestApi = vi.mocked(apiRequest);
const ledger = {
  id: 'ledger-1',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
};
const otherLedger = { ...ledger, id: 'ledger-2', name: '旅行基金' };
const accounts = [
  { id: 'acc-cash', name: '現金', isTemporary: false },
  { id: 'acc-bank', name: '銀行', isTemporary: false },
];
const category = { id: 'cat-food', name: '早餐', type: 'EXPENSE' };

function draft(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    ledgerId: ledger.id,
    type: 'EXPENSE',
    amount: 6000,
    date: '2026-10-23',
    title: '早餐',
    categoryId: category.id,
    newCategoryName: null,
    accountId: 'acc-cash',
    toAccountId: null,
    ...overrides,
  };
}

function renderList(items: AiDraftItem[]) {
  requestApi.mockImplementation((path: string) => {
    if (path === '/accounts') return Promise.resolve(accounts);
    if (path === '/ledgers?includeArchived=true') return Promise.resolve([ledger, otherLedger]);
    if (path.includes('/categories')) return Promise.resolve([category]);
    return Promise.resolve([]);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiDraftList
        items={items}
        currentLedgerId={ledger.id}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
        onSelect={vi.fn()}
        onConfirmAll={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('AI draft list', () => {
  it('W209 displays type, title, amount, date, category, account, transfer pair, other ledger, and missing fields', async () => {
    const items = [
      { key: 'expense', draft: draft() },
      {
        key: 'transfer',
        draft: draft({
          ledgerId: otherLedger.id,
          type: 'TRANSFER',
          categoryId: null,
          title: null,
          accountId: 'acc-cash',
          toAccountId: 'acc-bank',
        }),
      },
      {
        key: 'incomplete',
        draft: draft({
          title: '缺欄',
          amount: null,
          date: null,
          categoryId: null,
          accountId: null,
        }),
      },
    ];
    renderList(items);

    await screen.findByText('旅行基金');
    await screen.findByText('現金');
    const expense = screen.getByRole('button', { name: '編輯草稿：早餐' });
    expect(within(expense).getByText('支出')).toBeInTheDocument();
    expect(within(expense).getByText('$60')).toBeInTheDocument();
    expect(within(expense).getByText('2026-10-23')).toBeInTheDocument();
    expect(within(expense).getAllByText('早餐')).toHaveLength(2);
    expect(within(expense).getByText('現金')).toBeInTheDocument();

    const transfer = screen.getByRole('button', { name: '編輯草稿：名稱未提供' });
    expect(within(transfer).getByText('轉帳')).toBeInTheDocument();
    expect(within(transfer).getByText('現金 → 銀行')).toBeInTheDocument();
    expect(within(transfer).getByText('旅行基金')).toBeInTheDocument();
    expect(within(transfer).getAllByText('名稱未提供')).toHaveLength(2);
    expect(screen.getAllByText('金額未提供')).toHaveLength(1);
    expect(screen.getAllByText('日期未提供')).toHaveLength(1);
    expect(screen.getByText('分類未提供')).toBeInTheDocument();
    expect(screen.getByText('帳戶未提供')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: '編輯草稿：名稱未提供' })).getAllByText(
        '名稱未提供',
      ),
    ).toHaveLength(2);
    await waitFor(() =>
      expect(requestApi).toHaveBeenCalledWith('/ledgers/ledger-1/categories?type=EXPENSE'),
    );
  });

  it('W210 enables confirmation using shared completeness, keeps an optional null name valid, and discard does not write', async () => {
    const onConfirm = vi.fn();
    const onDiscard = vi.fn();
    const onSelect = vi.fn();
    const onConfirmAll = vi.fn();
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    requestApi.mockImplementation((path: string) => {
      if (path === '/accounts') return Promise.resolve(accounts);
      if (path === '/ledgers?includeArchived=true') return Promise.resolve([ledger]);
      if (path.includes('/categories')) return Promise.resolve([category]);
      return Promise.resolve([]);
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiDraftList
          items={[
            { key: 'complete', draft: draft({ title: null }) },
            {
              key: 'incomplete',
              draft: draft({ categoryId: null }),
            },
          ]}
          currentLedgerId={ledger.id}
          onConfirm={onConfirm}
          onDiscard={onDiscard}
          onSelect={onSelect}
          onConfirmAll={onConfirmAll}
        />
      </QueryClientProvider>,
    );

    const completeConfirm = screen.getByRole('button', { name: '確認草稿：名稱未提供' });
    const incompleteConfirm = screen.getByRole('button', { name: '確認草稿：早餐' });
    expect(completeConfirm).toBeEnabled();
    expect(incompleteConfirm).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '移除草稿：名稱未提供' }));
    expect(onDiscard).toHaveBeenCalledWith('complete');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onConfirmAll).not.toHaveBeenCalled();
    expect(requestApi).not.toHaveBeenCalledWith(expect.stringContaining('/transactions'));
  });
});
