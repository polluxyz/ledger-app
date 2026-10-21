import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerLeaveItem, LedgerLeavePreview } from '@ledger/shared';
import { LeaveItemPicker, LeavePreviewSections } from './LeaveItemPicker';
import styles from './LeaveItemPicker.module.css';

const item: LedgerLeaveItem = {
  id: 'item-1',
  date: '2026-10-01T12:00:00.000Z',
  title: '午餐',
  categoryIcon: 'food',
  accountEffects: [],
  share: 3500,
  paidByName: '小華',
  kind: 'SHARED',
};

const preview: LedgerLeavePreview = {
  items: [item],
  accounts: [],
  carryOvers: [],
  withdrawals: [],
  leave: { allowed: true, blockedBy: null },
};

/** W189 逐筆清單預設全勾，顯示付款人與份額，並將選取狀態交給外層保存。 */
describe('LeaveItemPicker', () => {
  it('starts with all items checked and shows the payer and my share', () => {
    render(
      <LeaveItemPicker
        items={[item]}
        preview={preview}
        previewError={null}
        isPreviewLoading={false}
        excludedItemIds={[]}
        selectedCount={1}
        onExcludedItemIdsChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(screen.getByText('小華付')).toBeInTheDocument();
    expect(screen.getByText('我的份額 $35')).toBeInTheDocument();
  });

  it('selects and clears every item, then returns to the leave dialog', async () => {
    const user = userEvent.setup();
    const onExcludedItemIdsChange = vi.fn();
    const onComplete = vi.fn();
    const props = {
      items: [item],
      preview,
      previewError: null,
      isPreviewLoading: false,
      onExcludedItemIdsChange,
      onComplete,
    } as const;
    const view = render(<LeaveItemPicker {...props} excludedItemIds={[]} selectedCount={1} />);

    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect(onExcludedItemIdsChange).toHaveBeenLastCalledWith(['item-1']);
    view.rerender(<LeaveItemPicker {...props} excludedItemIds={['item-1']} selectedCount={0} />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect(onExcludedItemIdsChange).toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('supports an initially unchecked include selection for private ledger moves', async () => {
    const user = userEvent.setup();
    const onSelectedItemIdsChange = vi.fn();
    render(
      <LeaveItemPicker
        items={[item]}
        preview={undefined}
        previewError={null}
        isPreviewLoading={false}
        excludedItemIds={[]}
        selectedCount={0}
        onExcludedItemIdsChange={vi.fn()}
        selectionMode="include"
        selectedItemIds={[]}
        onSelectedItemIdsChange={onSelectedItemIdsChange}
        submitLabel="下一步"
        onComplete={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(screen.queryByRole('heading', { name: '帳戶' })).not.toBeInTheDocument();
    await user.click(checkboxes[1]!);
    expect(onSelectedItemIdsChange).toHaveBeenCalledWith(['item-1']);
  });

  it('colors only the after balance by comparing the server values and keeps carryovers uncolored', () => {
    const colorPreview: LedgerLeavePreview = {
      ...preview,
      accounts: [
        { accountId: 'increase', name: '增加', balance: 10000, balanceAfter: 14000 },
        { accountId: 'decrease', name: '減少', balance: 15000, balanceAfter: 7000 },
        { accountId: 'same', name: '相等', balance: 3000, balanceAfter: 3000 },
        { accountId: 'zero', name: '歸零', balance: 9000, balanceAfter: 0 },
      ],
      carryOvers: [
        {
          ledgerPersonId: 'person-1',
          displayName: '小明',
          amount: 2000,
          counterpartyId: 'cp-1',
        },
      ],
    };
    render(<LeavePreviewSections preview={colorPreview} columnHint="現在 → 刪除後" />);

    expect(screen.getAllByText('現在 → 刪除後')).toHaveLength(2);
    expect(screen.getByText('$100')).toHaveClass(styles.balanceBefore!);
    expect(screen.getByText('$140')).toHaveClass(styles.balanceAfterIncome!);
    expect(screen.getByText('$70')).toHaveClass(styles.balanceAfterExpense!);
    const equalAmounts = screen.getAllByText('$30');
    expect(equalAmounts[0]).toHaveClass(styles.balanceBefore!);
    expect(equalAmounts[1]).toHaveClass(styles.balanceAfter!);
    expect(screen.getByText('$0')).toHaveClass(styles.balanceAfter!);
    const carryOverRow = screen.getByText('小明').closest('li');
    expect(carryOverRow).not.toBeNull();
    const carryOverAmount = carryOverRow?.querySelector(`.${styles.arrowAmount!}`);
    expect(carryOverAmount).not.toBeNull();
    expect(carryOverAmount).not.toHaveClass(styles.balanceAfterIncome!);
    expect(carryOverAmount).not.toHaveClass(styles.balanceAfterExpense!);
  });
});
