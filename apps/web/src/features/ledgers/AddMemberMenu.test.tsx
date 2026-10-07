import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddMemberMenu } from './AddMemberMenu';

/**
 * 「新增成員」的滑出選單（3f W143）。動畫只靠 `--motion-*` token，jsdom 不跑轉場，
 * 所以這裡只驗展開狀態與選了之後呼叫的動作。
 */
describe('AddMemberMenu', () => {
  it('slides out the two add choices and runs the selected action', async () => {
    const onAddCounterparty = vi.fn();
    const onAddVirtualMember = vi.fn();
    const user = userEvent.setup();
    render(
      <AddMemberMenu
        onAddCounterparty={onAddCounterparty}
        onAddVirtualMember={onAddVirtualMember}
      />,
    );

    const trigger = screen.getByRole('button', { name: '新增成員' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: '新增方式' })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '新增對象' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增虛擬成員' }));

    expect(onAddVirtualMember).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(onAddCounterparty).not.toHaveBeenCalled();
  });
});
