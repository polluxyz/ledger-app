import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * 打字確認的測試（Slice 2 Step 7.1）。
 *
 * 這個 prop 的整個價值就在「打對字之前按不下去」，所以那條界線要有獨立案例守住。
 * 另外一條同樣重要：`confirmText` 沒給的時候，元件必須跟以前一模一樣——既有的
 * 兩個呼叫點（刪帳戶、移除成員）都不希望多出一個輸入框。
 */
describe('ConfirmDialog', () => {
  it('asks for no typing when confirmText is omitted', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        title="刪除帳戶"
        message="刪除「現金」？"
        confirmLabel="刪除"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '刪除' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirm button disabled until the text matches exactly', async () => {
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        title="封存帳本"
        message="封存「家庭帳本」？"
        confirmLabel="封存"
        confirmText="家庭帳本"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole('button', { name: '封存' });
    expect(confirm).toBeDisabled();

    // 打得不完整不算數——這正是這個欄位要擋下的情況。
    await user.type(screen.getByLabelText('請輸入「家庭帳本」以確認'), '家庭');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('請輸入「家庭帳本」以確認'), '帳本');
    expect(confirm).toBeEnabled();
  });

  it('ignores whitespace around the typed text', async () => {
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        open
        title="封存帳本"
        message="封存「家庭帳本」？"
        confirmLabel="封存"
        confirmText="家庭帳本"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // 前後空白幾乎都是誤打或複製貼上帶進來的，擋下來只會讓人以為自己打錯了。
    await user.type(screen.getByLabelText('請輸入「家庭帳本」以確認'), ' 家庭帳本 ');

    expect(screen.getByRole('button', { name: '封存' })).toBeEnabled();
  });

  it('forgets what was typed after the dialog closes', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開啟
          </button>
          <ConfirmDialog
            open={open}
            title="封存帳本"
            message="封存「家庭帳本」？"
            confirmLabel="封存"
            confirmText="家庭帳本"
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);

    await user.type(screen.getByLabelText('請輸入「家庭帳本」以確認'), '家庭帳本');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '開啟' }));

    // 留著上次打的字，等於下一次只要按一下就成立，打字確認就白做了。
    expect(screen.getByLabelText('請輸入「家庭帳本」以確認')).toHaveValue('');
    expect(screen.getByRole('button', { name: '封存' })).toBeDisabled();
  });
});
