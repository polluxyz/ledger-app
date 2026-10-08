import type { CounterpartyLedgerPart } from '@ledger/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LedgerSourceList } from './LedgerSourceList';

/** LedgerSourceList 驗共享帳本來源的單行版面、「誰欠誰」方向與唯讀狀態。 */
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

  it('shows one-line sources with owe arrows and opens the selected source by keyboard', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<LedgerSourceList sources={sources} onOpenSource={onOpenSource} />);

    // 單行：帳本名稱 · 人名（人名一定要在文字裡，頭貼只有一個字分不出兩個「小」）＋金額不带正負號。
    expect(screen.getByText('花蓮三日 · 明哥')).toBeInTheDocument();
    expect(screen.getByText('老家 · 小明')).toBeInTheDocument();
    expect(screen.getByText('$512')).toBeInTheDocument();
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.queryByText('-$25')).not.toBeInTheDocument();
    // 可存取名稱仍是完整句子。
    expect(screen.getByText('明哥欠你 $512')).toBeInTheDocument();
    expect(screen.getByText('你欠小明 $25')).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();

    const sourceButton = screen.getByRole('button', { name: /花蓮三日/ });
    expect(sourceButton).not.toHaveAttribute('aria-label');
    sourceButton.focus();
    await user.keyboard('{Enter}');

    expect(onOpenSource).toHaveBeenCalledWith(sources[0]);
  });

  it('renders overview sources without an action button', () => {
    render(<LedgerSourceList sources={sources} readOnly />);

    expect(screen.getByText('花蓮三日 · 明哥')).toBeInTheDocument();
    expect(screen.getByText('明哥欠你 $512')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
