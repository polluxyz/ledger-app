import type { CounterpartyLedgerPart } from '@ledger/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import rowStyles from './DebtRow.module.css';
import { LedgerSourceList } from './LedgerSourceList';

/** LedgerSourceList 驗帳本分組、共用列欄位、「誰欠誰」方向與唯讀狀態。 */
describe('LedgerSourceList', () => {
  const sources: CounterpartyLedgerPart[] = [
    {
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-ming',
      personName: '明哥',
      amount: 51200,
      left: false,
    },
    {
      ledgerId: 'ledger-old-home',
      ledgerName: '老家',
      personId: 'person-xiao',
      personName: '小明',
      amount: -2500,
      left: true,
    },
  ];

  it('groups rows by ledger and opens a source by keyboard without repeating the person name', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<LedgerSourceList sources={sources} onOpenSource={onOpenSource} />);

    expect(screen.getByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '老家' })).toBeInTheDocument();
    expect(screen.queryByText('花蓮三日 · 明哥')).not.toBeInTheDocument();
    expect(screen.queryByText('老家 · 小明')).not.toBeInTheDocument();
    expect(screen.getByText('$512')).toBeInTheDocument();
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.queryByText('-$25')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '明哥欠你 $512' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '你欠小明 $25' })).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();

    const sourceButton = screen.getByRole('button', { name: '明哥欠你 $512' });
    expect(sourceButton.classList.contains(rowStyles.row!)).toBe(true);
    expect(sourceButton.querySelector(`.${rowStyles.date}`)).toBeInTheDocument();
    expect(sourceButton.querySelector(`.${rowStyles.arrow}`)).toBeInTheDocument();
    expect(sourceButton.querySelector('[title="明哥"]')).toHaveTextContent('明');
    expect(sourceButton.querySelector('[title="我"]')).toHaveTextContent('我');
    sourceButton.focus();
    await user.keyboard('{Enter}');

    expect(onOpenSource).toHaveBeenCalledWith(sources[0]);
  });

  it('renders overview sources without an action button', () => {
    render(<LedgerSourceList sources={sources} readOnly />);

    expect(screen.getByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '明哥欠你 $512' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
