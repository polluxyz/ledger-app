import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SplitParticipantDraft } from './split-form';
import { SplitOptionsView } from './SplitOptionsView';

function person(
  key: string,
  counterpartyId: string | null,
  name: string,
  isMe = false,
): SplitParticipantDraft {
  return {
    key,
    counterpartyId,
    name,
    isMe,
    included: true,
    amountFixed: false,
    amountInput: '',
    amountValue: 0,
    ratioFixed: false,
    ratioInput: '',
    ratioValue: 0,
  };
}

const participants = [
  person('me', null, '我', true),
  person('xiao-ming', 'cp-1', '小明'),
  person('xiao-hua', 'cp-2', '小華'),
];

describe('SplitOptionsView', () => {
  it('fills the remaining ratio and disables save when the total reaches 115%', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSave = vi.fn();

    render(
      <SplitOptionsView
        total={300000}
        type="EXPENSE"
        payerCounterpartyId={null}
        payerName="我"
        method="EQUAL"
        precision="CENT"
        participants={participants}
        onBack={onBack}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('tab', { name: '比例' }));
    await user.clear(screen.getByLabelText('我 比例'));
    await user.type(screen.getByLabelText('我 比例'), '20');
    expect(screen.getByLabelText('小明 比例')).toHaveValue(40);
    expect(screen.getByLabelText('小華 比例')).toHaveValue(40);

    await user.clear(screen.getByLabelText('小明 比例'));
    await user.type(screen.getByLabelText('小明 比例'), '95');
    expect(screen.getByRole('status')).toHaveTextContent('比例合計 115%');
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows equal share arrows and saves the selected method without submitting the transaction', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <SplitOptionsView
        total={300000}
        type="EXPENSE"
        payerCounterpartyId={null}
        payerName="我"
        method="EQUAL"
        precision="CENT"
        participants={participants}
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole('tab', { name: '均分' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('小明欠你 $1,000')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'EQUAL', precision: 'CENT', participants }),
    );
  });

  it('uses generic ledger person keys for payer previews and returns them unchanged', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const ledgerPeople = [
      person('person-me', null, '我', true),
      person('person-ming', null, '小明'),
      person('person-hua', null, '小華'),
    ];

    render(
      <SplitOptionsView
        total={100000}
        type="EXPENSE"
        payerKey="person-ming"
        payerName="小明"
        method="EQUAL"
        precision="CENT"
        participants={ledgerPeople}
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('你欠小明 $333.33')).toBeInTheDocument();
    expect(screen.getByText('小華欠小明 $333.33')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'EQUAL',
        participants: ledgerPeople,
      }),
    );
  });
});
