import type { LedgerGroup } from '@ledger/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnpointedLedgerGroups } from './UnpointedLedgerGroups';

/** 未指向群組只呈現 API 已分好的帳本與人，空回應不佔借還頁版面。 */
describe('UnpointedLedgerGroups', () => {
  const groups: LedgerGroup[] = [
    {
      ledger: { id: 'ledger-hualien', name: '花蓮三日', left: true },
      people: [
        {
          person: { id: 'person-xiao', name: '小明', userId: null, status: 'GUEST' },
          amount: -51200,
          pointer: { counterpartyId: null, auto: false },
        },
      ],
    },
  ];

  it('hides an empty API result', () => {
    const { container } = render(<UnpointedLedgerGroups groups={[]} onOpenSource={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('labels exited ledgers and forwards the selected person and amount', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    render(<UnpointedLedgerGroups groups={groups} onOpenSource={onOpenSource} />);

    expect(screen.getByText('花蓮三日')).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();
    expect(screen.getByText('你欠小明 $512')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /唯讀畫面/ }));

    expect(onOpenSource).toHaveBeenCalledWith({
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-xiao',
      personName: '小明',
      amount: -51200,
      left: true,
    });
  });
});
