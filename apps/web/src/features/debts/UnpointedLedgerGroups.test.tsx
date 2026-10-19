import type { LedgerGroup } from '@ledger/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnpointedLedgerGroups } from './UnpointedLedgerGroups';

/** 未指向群組只呈現 API 已分好的帳本與人，空回應不佔借還頁版面。 */
describe('UnpointedLedgerGroups', () => {
  const groups: LedgerGroup[] = [
    {
      ledger: { id: 'ledger-hualien', name: '花蓮三日' },
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
    const { container } = render(<UnpointedLedgerGroups groups={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('shows each ledger with read-only source rows', () => {
    render(<UnpointedLedgerGroups groups={groups} />);

    expect(screen.getByText('花蓮三日')).toBeInTheDocument();
    expect(screen.getByText('你欠小明 $512')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
