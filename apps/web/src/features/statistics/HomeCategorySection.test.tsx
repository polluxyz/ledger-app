import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { StatisticsGroup } from '@ledger/shared';
import styles from './HomeCategorySection.module.css';
import { HomeCategorySection } from './HomeCategorySection';

/** 首頁分類段直接傳入統計回應，驗證名稱、排序、百分比、顏色與展開行為。 */
describe('HomeCategorySection', () => {
  function category(id: string, percentageBps: number): StatisticsGroup {
    return {
      kind: 'CATEGORY',
      category: { id, name: id, icon: null },
      amount: 12500,
      percentageBps,
    };
  }

  const groups: StatisticsGroup[] = [
    { kind: 'DIFFERENCE', category: null, amount: 10000, percentageBps: 0 },
    { kind: 'BAD_DEBT', category: null, amount: 20000, percentageBps: 1234 },
    { kind: 'DEBT_FORGIVEN', category: null, amount: 30000, percentageBps: 2000 },
    { kind: 'UNCATEGORIZED', category: null, amount: 40000, percentageBps: 3000 },
    ...Array.from({ length: 11 }, (_, index) => category(`分類 ${index + 1}`, 500 + index)),
  ];

  it('shows the first five groups in API order and expands all fifteen with API percentages', () => {
    render(
      <MemoryRouter>
        <HomeCategorySection
          expenseGroups={groups}
          ledgerName="家用"
          statisticsHref="/stats?ledgerId=ledger-home&from=2026-10-01&to=2026-10-31&tab=categories"
          colorOf={() => 'var(--color-accent)'}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '家用 · 本月支出' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '明細 →' })).toHaveAttribute(
      'href',
      '/stats?ledgerId=ledger-home&from=2026-10-01&to=2026-10-31&tab=categories',
    );

    const list = screen.getByRole('list', { name: '支出分類' });
    const firstFive = within(list).getAllByRole('listitem');
    expect(firstFive).toHaveLength(5);
    expect(firstFive.map((item) => item.textContent)).toEqual([
      '結清差額$100<0.01%',
      '呆帳$20012.34%',
      '債務免除$30020%',
      '未分類$40030%',
      '分類 1$1255%',
    ]);
    expect(firstFive[0]?.querySelector(`.${styles.swatch}`)).toHaveStyle({
      '--group-color': 'var(--color-accent)',
    });

    fireEvent.click(screen.getByRole('button', { name: '全部 15 類' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(15);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows the empty state and keeps the supplied statistics destination', () => {
    render(
      <MemoryRouter>
        <HomeCategorySection
          expenseGroups={[]}
          ledgerName={null}
          statisticsHref="/stats?tab=categories"
          colorOf={() => 'red'}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '本月支出' })).toBeInTheDocument();
    expect(screen.getByText('本月沒有支出')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '明細 →' })).toHaveAttribute(
      'href',
      '/stats?tab=categories',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
