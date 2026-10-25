import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Counterparty, LedgerGroup, Paginated } from '@ledger/shared';
import { DebtsCard } from './DebtsCard';

/** 首頁借還卡直接接兩份 query 狀態，驗證各自呈現、金額來源與空狀態。 */
describe('DebtsCard', () => {
  type QueryState<T> = { data: T | undefined; error: Error | null; isLoading: boolean };

  function queryState<T>(
    data: T | undefined,
    options: { error?: Error; isLoading?: boolean } = {},
  ): QueryState<T> {
    return {
      data,
      error: options.error ?? null,
      isLoading: options.isLoading ?? false,
    };
  }

  function counterparty(
    id: string,
    displayName: string,
    balance: number,
    totalBalance: number,
  ): Counterparty {
    return {
      id,
      name: displayName,
      displayName,
      askMerge: false,
      balance,
      ledgerParts: [],
      totalBalance,
      link: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
  }

  function paginated(items: Counterparty[], total = items.length): Paginated<Counterparty> {
    return { items, page: 1, limit: 5, total };
  }

  function ledgerGroup(name: string, personName: string, amount: number): LedgerGroup {
    return {
      ledger: { id: `ledger-${name}`, name },
      people: [
        {
          person: {
            id: `person-${personName}`,
            name: personName,
            userId: null,
            status: 'GUEST',
          },
          amount,
          pointer: { counterpartyId: null, auto: false },
        },
      ],
    };
  }

  function renderCard(
    counterpartiesQuery: QueryState<Paginated<Counterparty>>,
    unpointedLedgersQuery: QueryState<LedgerGroup[]>,
    showAllLink = true,
  ) {
    return render(
      <MemoryRouter>
        <DebtsCard
          counterpartiesQuery={counterpartiesQuery}
          unpointedLedgersQuery={unpointedLedgersQuery}
          showAllLink={showAllLink}
        />
      </MemoryRouter>,
    );
  }

  it('uses totalBalance for both direction and amount and links to the overview', () => {
    const people = [
      counterparty('person-1', '小明', 25000, -13400),
      counterparty('person-2', '阿芳', -8000, 7300),
      ...Array.from({ length: 3 }, (_, index) =>
        counterparty(`person-${index + 3}`, `對象 ${index + 3}`, 0, 0),
      ),
    ];
    renderCard(queryState(paginated(people, 7)), queryState([]));

    const list = screen.getByRole('list', { name: '往來對象' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByLabelText('你欠小明 $134')).toBeInTheDocument();
    expect(screen.getByLabelText('阿芳欠你 $73')).toBeInTheDocument();
    expect(screen.getByLabelText('對象 3與我兩清')).toHaveTextContent('兩清');
    expect(screen.queryByText('$250')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '全部 7 人 →' })).toHaveAttribute(
      'href',
      '/transactions?view=debts&tab=overview',
    );
  });

  it('shows unpointed ledger people with their API amount without counting them as counterparties', () => {
    renderCard(queryState(paginated([], 0)), queryState([ledgerGroup('家用', '小安', -45000)]));

    expect(screen.getByRole('heading', { name: '家用' })).toBeInTheDocument();
    expect(screen.getByLabelText('你欠小安 $450')).toBeInTheDocument();
    expect(screen.queryByText('全部 1 人 →')).not.toBeInTheDocument();
    expect(screen.queryByText('沒有借還')).not.toBeInTheDocument();
  });

  it('uses people.amount for positive, negative, and zero unpointed balances', () => {
    renderCard(
      queryState(paginated([], 0)),
      queryState([
        ledgerGroup('收入', '小芳', 12500),
        ledgerGroup('支出', '小林', -4000),
        ledgerGroup('結清', '小王', 0),
      ]),
    );

    expect(screen.getByLabelText('小芳欠你 $125')).toBeInTheDocument();
    expect(screen.getByLabelText('你欠小林 $40')).toBeInTheDocument();
    expect(screen.getByLabelText('小王與我兩清')).toBeInTheDocument();
    for (const name of ['小芳', '小林', '小王']) {
      const row = screen.getByLabelText(new RegExp(name));
      expect(row.textContent?.match(new RegExp(name, 'g'))).toHaveLength(1);
      expect(row).toHaveTextContent('我');
    }
  });

  it('shows no-debts only after both sources succeed with no data', () => {
    renderCard(queryState(paginated([], 0)), queryState([]));

    expect(screen.getByText('沒有借還')).toBeInTheDocument();
  });

  it('keeps ledger rows visible when counterparties fail', () => {
    renderCard(
      queryState<Paginated<Counterparty>>(undefined, { error: new Error('request failed') }),
      queryState([ledgerGroup('旅行', '小林', 12000)]),
    );

    expect(screen.getByText('對象暫時無法載入')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '旅行' })).toBeInTheDocument();
    expect(screen.queryByText('沒有借還')).not.toBeInTheDocument();
  });

  it('keeps counterparty rows visible when unpointed ledgers fail and hides overview links when asked', () => {
    renderCard(
      queryState(paginated([counterparty('person-1', '阿明', 0, 26000)], 6)),
      queryState<LedgerGroup[]>(undefined, { error: new Error('request failed') }),
      false,
    );

    expect(screen.getByText('帳本暫時無法載入')).toBeInTheDocument();
    expect(screen.getByLabelText('阿明欠你 $260')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '全部 →' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '全部 6 人 →' })).not.toBeInTheDocument();
    expect(screen.queryByText('沒有借還')).not.toBeInTheDocument();
  });

  it('shows each counterparty and unpointed name once beside the summary direction', () => {
    renderCard(
      queryState(paginated([counterparty('person-1', '小明', 0, 12000)])),
      queryState([ledgerGroup('家用', '小美', -12000)]),
    );

    for (const name of ['小明', '小美']) {
      const row = screen.getByLabelText(new RegExp(name));
      expect(row.textContent?.match(new RegExp(name, 'g'))).toHaveLength(1);
      expect(row).toHaveTextContent('我');
    }
  });

  it('does not claim there are no debts while one source is loading', () => {
    renderCard(
      queryState(paginated([], 0)),
      queryState<LedgerGroup[]>(undefined, { isLoading: true }),
    );

    expect(screen.getByText('帳本載入中…')).toBeInTheDocument();
    expect(screen.queryByText('沒有借還')).not.toBeInTheDocument();
  });
});
