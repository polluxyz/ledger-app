import type { CounterpartyLedgerPart } from '@ledger/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LedgerSourceList } from './LedgerSourceList';

/** LedgerSourceList 驗共享帳本來源的正負方向、退出標籤與可操作入口。 */
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

  it('shows signed arrows and opens the selected API source with keyboard activation', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<LedgerSourceList sources={sources} onOpenSource={onOpenSource} />);

    expect(screen.getByText('明哥欠你 $512')).toBeInTheDocument();
    expect(screen.getByText('你欠小明 $25')).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();
    const sourceButton = screen.getByRole('button', { name: /開啟 花蓮三日 的結清/ });
    sourceButton.focus();
    await user.keyboard('{Enter}');

    expect(onOpenSource).toHaveBeenCalledWith(sources[0]);
  });
});
