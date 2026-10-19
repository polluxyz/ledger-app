import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerLeaveItem, LedgerLeavePreview } from '@ledger/shared';
import { LeaveItemPicker } from './LeaveItemPicker';

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
});
