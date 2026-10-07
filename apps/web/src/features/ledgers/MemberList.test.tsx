import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemberList } from './MemberList';

describe('MemberList', () => {
  const members = [
    { userId: 'u1', email: 'owner@example.com', name: '小安', role: 'OWNER' as const },
    { userId: 'u2', email: 'bob@example.com', name: '明哥', role: 'EDITOR' as const },
  ];
  const virtualMembers = [{ id: 'person-1', name: '阿美', userId: null, status: 'GUEST' as const }];

  it('shows members and virtual members in one list without email, with their pointers', () => {
    render(
      <MemberList
        members={members}
        virtualMembers={virtualMembers}
        currentUserId="u1"
        isOwner
        isArchived={false}
        canManageVirtualMembers
        pointerNames={{ u2: '明哥的對象', 'person-1': '小華' }}
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onLeave={vi.fn()}
        onRenameVirtualMember={vi.fn()}
        onDeleteVirtualMember={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: '帳本成員' });
    expect(within(list).getByText('小安')).toBeInTheDocument();
    expect(within(list).getByText('明哥')).toBeInTheDocument();
    expect(within(list).getByText('阿美')).toBeInTheDocument();
    expect(within(list).getByText('虛擬成員')).toBeInTheDocument();
    expect(within(list).getByText('→ 明哥的對象')).toBeInTheDocument();
    expect(within(list).getByText('→ 小華')).toBeInTheDocument();
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名阿美' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除阿美' })).toBeInTheDocument();
  });

  it('puts remove last in the role select and asks the caller to confirm', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <MemberList
        members={members}
        virtualMembers={[]}
        currentUserId="u1"
        isOwner
        isArchived={false}
        canManageVirtualMembers={false}
        pointerNames={{}}
        onChangeRole={vi.fn()}
        onRemove={onRemove}
        onLeave={vi.fn()}
        onRenameVirtualMember={vi.fn()}
        onDeleteVirtualMember={vi.fn()}
      />,
    );

    const roleSelect = screen.getByLabelText('明哥的角色');
    expect(
      within(roleSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['擁有者', '可編輯', '唯讀', '移除']);

    const removeOption = screen.getByRole('option', { name: '移除' });
    await user.selectOptions(roleSelect, removeOption.getAttribute('value') ?? '');

    expect(onRemove).toHaveBeenCalledWith(members[1]);
  });

  it('places exit at the bottom of the shared member section', () => {
    render(
      <MemberList
        members={members}
        virtualMembers={virtualMembers}
        currentUserId="u1"
        isOwner
        isArchived={false}
        canManageVirtualMembers
        pointerNames={{}}
        onChangeRole={vi.fn()}
        onRemove={vi.fn()}
        onLeave={vi.fn()}
        onRenameVirtualMember={vi.fn()}
        onDeleteVirtualMember={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: '帳本成員' });
    const leave = screen.getByRole('button', { name: '退出帳本' });
    expect(list.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
