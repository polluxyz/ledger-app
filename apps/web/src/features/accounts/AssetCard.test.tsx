import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Account, BalanceTrend } from '@ledger/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { AssetCard } from './AssetCard';

/** 資產卡直接吃 query 回應，確認總額與帳戶各自處理狀態且不自行加總。 */
describe('AssetCard', () => {
  type QueryState<T> = Pick<UseQueryResult<T, Error>, 'data' | 'error' | 'isLoading'>;

  const total: BalanceTrend = {
    months: [
      { month: '2026-09', total: 125000 },
      { month: '2026-10', total: 458900 },
    ],
  };

  const accounts: Account[] = [
    {
      id: 'cash',
      name: '現金',
      initialBalance: 0,
      balance: 200000,
      isTemporary: false,
      hasTransactions: true,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];

  function renderCard(
    totalQuery: QueryState<BalanceTrend>,
    accountsQuery: QueryState<Account[]>,
    categorySection?: ReactNode,
  ) {
    return render(
      <MemoryRouter>
        <AssetCard
          totalQuery={totalQuery}
          accountsQuery={accountsQuery}
          categorySection={categorySection}
        />
      </MemoryRouter>,
    );
  }

  it('shows the final trend total, account rows, supplied category section, and account link', () => {
    renderCard(
      { data: total, error: null, isLoading: false },
      { data: accounts, error: null, isLoading: false },
      <div>分類段</div>,
    );

    expect(screen.getByRole('heading', { name: '資產' })).toBeInTheDocument();
    expect(screen.getByLabelText('總額 $4,589')).toHaveTextContent('$4,589');
    expect(screen.getByLabelText('現金餘額')).toHaveTextContent('$2,000');
    expect(screen.getByText('分類段')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '管理' })).toHaveAttribute('href', '/accounts');
  });

  it('keeps the account list visible when the total query fails', () => {
    renderCard(
      { data: undefined, error: new Error('request failed'), isLoading: false },
      { data: accounts, error: null, isLoading: false },
    );

    expect(screen.getByText('總額暫時無法載入')).toBeInTheDocument();
    expect(screen.getByLabelText('現金餘額')).toHaveTextContent('$2,000');
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('keeps the total visible when the account query fails', () => {
    renderCard(
      { data: total, error: null, isLoading: false },
      { data: undefined, error: new Error('request failed'), isLoading: false },
    );

    expect(screen.getByLabelText('總額 $4,589')).toHaveTextContent('$4,589');
    expect(screen.getByText('帳戶暫時無法載入')).toBeInTheDocument();
  });
});
