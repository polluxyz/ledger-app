import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Account } from '@ledger/shared';
import styles from './HomeAccountList.module.css';
import { HomeAccountList } from './HomeAccountList';

/** 首頁帳戶清單直接吃 API 回應，驗證可見規則、順序、金額與依數量套用的欄位容器。 */
describe('HomeAccountList', () => {
  function makeAccounts(count: number): Account[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `account-${index + 1}`,
      name: `帳戶 ${index + 1}`,
      initialBalance: 0,
      balance: index === 1 ? -12500 : (index + 1) * 10000,
      isTemporary: index === 7,
      hasTransactions: index === 7,
      createdAt: '2026-10-01T00:00:00.000Z',
    }));
  }

  function temporaryAccount(hasTransactions: boolean): Account {
    return {
      id: `temporary-${hasTransactions ? 'used' : 'empty'}`,
      name: 'Internal temporary account',
      initialBalance: 0,
      balance: 5000,
      isTemporary: true,
      hasTransactions,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
  }

  function readAccountListCss(): string {
    return readFileSync(
      join(process.cwd(), 'src/features/accounts/HomeAccountList.module.css'),
      'utf8',
    );
  }

  it('shows an empty state for zero accounts', () => {
    render(<HomeAccountList accounts={[]} />);

    expect(screen.getByText('還沒有帳戶。')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows all five accounts in one column without an expansion control', () => {
    render(<HomeAccountList accounts={makeAccounts(5)} />);

    const list = screen.getByRole('list', { name: '帳戶' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(list.classList.contains(styles.multiColumnList ?? '')).toBe(false);
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['帳戶 1$100', '帳戶 2-$125', '帳戶 3$300', '帳戶 4$400', '帳戶 5$500']);
    expect(screen.getByLabelText('帳戶 2餘額')).toHaveTextContent('-$125');
    const negativeBalance = within(list).getByText('-$125');
    const positiveBalance = within(list).getByText('$100');
    expect(negativeBalance.className).toMatch(/negative/);
    expect(positiveBalance.className).not.toMatch(/negative/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps long account names intact in the DOM while truncating them to one line', () => {
    const longName = '年度海外旅行、家電與搬家預備基金';
    const accounts = makeAccounts(1).map((account) => ({ ...account, name: longName }));

    render(<HomeAccountList accounts={accounts} />);

    const accountName = screen.getByText(longName);
    expect(accountName.className).toContain(styles.name ?? 'name');

    const nameRule = readAccountListCss().match(/\.name\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(nameRule).toContain('min-width: 0;');
    expect(nameRule).toContain('overflow: hidden;');
    expect(nameRule).toContain('text-overflow: ellipsis;');
    expect(nameRule).toContain('white-space: nowrap;');
  });

  it('shows all six accounts immediately without expansion controls', () => {
    render(<HomeAccountList accounts={makeAccounts(6)} />);

    const list = screen.getByRole('list', { name: '帳戶' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(list.classList.contains(styles.multiColumnList ?? '')).toBe(true);
    expect(screen.queryByRole('button', { name: /全部 \d+ 個|收起/ })).not.toBeInTheDocument();
  });

  it('does not display or count an empty temporary account', () => {
    render(<HomeAccountList accounts={[...makeAccounts(6), temporaryAccount(false)]} />);

    const list = screen.getByRole('list', { name: '帳戶' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).queryByText('臨時帳戶')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全部 \d+ 個|收起/ })).not.toBeInTheDocument();
  });

  it('shows an empty message when the only account is an empty temporary account', () => {
    render(<HomeAccountList accounts={[temporaryAccount(false)]} />);

    expect(screen.getByText('還沒有帳戶。')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a used temporary account as 臨時帳戶', () => {
    render(<HomeAccountList accounts={[temporaryAccount(true)]} />);

    const list = screen.getByRole('list', { name: '帳戶' });
    expect(within(list).getByText('臨時帳戶')).toBeInTheDocument();
    expect(within(list).queryByText('Internal temporary account')).not.toBeInTheDocument();
  });

  it('shows all twelve accounts in API order and applies the 440px container query', () => {
    render(<HomeAccountList accounts={makeAccounts(12)} />);

    const list = screen.getByRole('list', { name: '帳戶' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.textContent)).toEqual([
      '帳戶 1$100',
      '帳戶 2-$125',
      '帳戶 3$300',
      '帳戶 4$400',
      '帳戶 5$500',
      '帳戶 6$600',
      '帳戶 7$700',
      '臨時帳戶$800',
      '帳戶 9$900',
      '帳戶 10$1,000',
      '帳戶 11$1,100',
      '帳戶 12$1,200',
    ]);
    expect(list.classList.contains(styles.multiColumnList ?? '')).toBe(true);
    expect(screen.queryByRole('button', { name: /全部 \d+ 個|收起/ })).not.toBeInTheDocument();
    expect(rows[7]).toHaveTextContent('臨時帳戶');

    const source = readAccountListCss();
    expect(source).toContain('container-type: inline-size');
    expect(source).toContain('@container home-account-list (min-width: 440px)');
    expect(source).toContain('width: 100%');
    expect(source).toContain('width: 50%');
    expect(source).toContain('box-sizing: border-box');
  });
});
