import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeLayoutConflictDialog } from './HomeLayoutConflictDialog';

/** 這組測試驗證衝突彈窗的精簡文字、初始焦點、焦點循環與 Esc 關閉。 */
describe('HomeLayoutConflictDialog', () => {
  it('shows only the title and two choices, manages focus, and returns to editing on Escape', () => {
    const onClose = vi.fn();
    render(
      <HomeLayoutConflictDialog
        open
        isSaving={false}
        onLoadLatest={vi.fn()}
        onOverwrite={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '版面已在其他地方更新' });
    const loadLatest = screen.getByRole('button', { name: '載入最新' });
    const overwrite = screen.getByRole('button', { name: '用我的覆蓋' });
    expect(dialog.querySelectorAll('p')).toHaveLength(0);
    expect(loadLatest).toHaveFocus();

    fireEvent.keyDown(loadLatest, { key: 'Tab' });
    expect(overwrite).toHaveFocus();
    fireEvent.keyDown(overwrite, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('routes both decisions to their callbacks and disables them while a save is active', () => {
    const onLoadLatest = vi.fn();
    const onOverwrite = vi.fn();
    const { rerender } = render(
      <HomeLayoutConflictDialog
        open
        isSaving={false}
        onLoadLatest={onLoadLatest}
        onOverwrite={onOverwrite}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '載入最新' }));
    fireEvent.click(screen.getByRole('button', { name: '用我的覆蓋' }));
    expect(onLoadLatest).toHaveBeenCalledTimes(1);
    expect(onOverwrite).toHaveBeenCalledTimes(1);

    rerender(
      <HomeLayoutConflictDialog
        open
        isSaving
        onLoadLatest={onLoadLatest}
        onOverwrite={onOverwrite}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '載入最新' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '用我的覆蓋' })).toBeDisabled();
  });
});
