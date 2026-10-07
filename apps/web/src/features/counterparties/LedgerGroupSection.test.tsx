import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Counterparty, LedgerGroup } from '@ledger/shared';
import { LedgerGroupSection } from './LedgerGroupSection';

const counterparty: Counterparty = {
  id: 'counterparty-1',
  name: '小明',
  displayName: '明哥',
  askMerge: false,
  balance: 0,
  ledgerParts: [],
  totalBalance: 0,
  link: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const group: LedgerGroup = {
  ledger: { id: 'ledger-1', name: '家用帳本', left: false },
  people: [
    {
      person: { id: 'person-1', name: '小安', userId: 'user-2', status: 'MEMBER' },
      amount: 500,
      pointer: { counterpartyId: 'counterparty-1', auto: true },
    },
    {
      person: { id: 'person-2', name: '室友', userId: null, status: 'GUEST' },
      amount: 0,
      pointer: { counterpartyId: null, auto: false },
    },
  ],
};

// 以 mock API 型別驗證帳本群組照回應順序呈現標籤、人名、指向，並覆蓋已退出時的唯讀狀態。
describe('LedgerGroupSection', () => {
  it('shows the ledger labels, API-ordered people, pointer name, and guest badge', () => {
    render(
      <LedgerGroupSection group={group} counterparties={[counterparty]} onSetPointer={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: '家用帳本' })).toBeInTheDocument();
    expect(screen.getByText('共享帳本')).toBeInTheDocument();
    expect(screen.getByText('→ 明哥')).toBeInTheDocument();
    expect(screen.getByText('虛擬成員')).toBeInTheDocument();
    const names = screen.getAllByText(/^(小安|室友)$/);
    expect(names.map((name) => name.textContent)).toEqual(['小安', '室友']);
  });

  it('marks an exited ledger and does not offer pointer buttons or open people details', () => {
    const onSetPointer = vi.fn();
    render(
      <LedgerGroupSection
        group={{ ...group, ledger: { ...group.ledger, left: true } }}
        counterparties={[counterparty]}
        onSetPointer={onSetPointer}
      />,
    );

    expect(screen.getByText('已退出')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '指向' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '小安' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('小安'));
    expect(onSetPointer).not.toHaveBeenCalled();
  });
});
