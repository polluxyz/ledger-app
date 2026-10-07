import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddMemberMenu } from './AddMemberMenu';

describe('AddMemberMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('shows the choices immediately when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const user = userEvent.setup();
    render(<AddMemberMenu onAddCounterparty={vi.fn()} onAddVirtualMember={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '新增成員' }));

    const group = screen.getByRole('group', { name: '新增方式' });
    expect(group).toHaveAttribute('data-reduced-motion', 'true');
    expect(group).toHaveStyle({ transitionDuration: '0ms' });
    expect(screen.getByRole('button', { name: '新增對象' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增虛擬成員' })).toBeInTheDocument();
  });
});
