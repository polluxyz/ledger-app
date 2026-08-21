import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

/**
 * 共用彈窗外殼的測試。三件事是它存在的理由，因此各有獨立案例：
 * 掛載後真的呼叫 showModal()（否則沒有焦點鎖定與遮罩，只是一塊浮在頁面上的方框）、
 * Esc 與關閉鈕都會通知父層、以及**關閉時整個卸載**而不只是隱藏。
 */
/**
 * jsdom 尚未實作 showModal / close，補上最小的替身。
 *
 * AuthDialog.test.tsx 也有同一段。刻意暫時重複——把它收攏到 test/setup.ts 比較
 * 乾淨，但那必須動到那個檔案，而本次重構的驗收條件正是「該檔一字未改仍全綠」。
 * 等這次重構被證明沒問題後，再用獨立的 commit 收攏。
 */
function stubShowModal() {
  return vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
}

describe('Dialog', () => {
  // 留住替身本身，斷言時才不必去讀 prototype 上的方法（那是未綁定的參考）。
  let showModal: ReturnType<typeof stubShowModal>;

  beforeEach(() => {
    showModal = stubShowModal();
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });
  });

  it('renders the title and children once open', () => {
    render(
      <Dialog open title="新增帳戶" onClose={vi.fn()}>
        <p>表單內容</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: '新增帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新增帳戶' })).toBeInTheDocument();
    expect(screen.getByText('表單內容')).toBeInTheDocument();
  });

  it('calls showModal so the browser provides focus trapping and the backdrop', () => {
    render(
      <Dialog open title="新增帳戶" onClose={vi.fn()}>
        <p>表單內容</p>
      </Dialog>,
    );

    // 只加 open 屬性不會有遮罩與焦點鎖定，必須真的呼叫 showModal()。
    expect(showModal).toHaveBeenCalled();
  });

  it('notifies the parent when the close button is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open title="新增帳戶" onClose={onClose}>
        <p>表單內容</p>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: '關閉' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('notifies the parent when the dialog closes on its own (Esc)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="新增帳戶" onClose={onClose}>
        <p>表單內容</p>
      </Dialog>,
    );

    // jsdom 不會把 Esc 轉成 dialog 的關閉行為，因此直接送出 close 事件——
    // 驗的是「onClose 有接到 <dialog> 上」，那正是 Esc 最終會觸發的東西。
    fireEvent(screen.getByRole('dialog'), new Event('close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at all when closed', () => {
    render(
      <Dialog open={false} title="新增帳戶" onClose={vi.fn()}>
        <p>表單內容</p>
      </Dialog>,
    );

    // 「不在 DOM 裡」而不是「在 DOM 裡但隱藏」：下次開啟時內容必定是乾淨的。
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('表單內容')).not.toBeInTheDocument();
  });

  it('starts from a clean slate when reopened', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開啟
          </button>
          <Dialog open={open} title="新增帳戶" onClose={() => setOpen(false)}>
            <input aria-label="名稱" />
          </Dialog>
        </>
      );
    }

    render(<Harness />);

    await user.type(screen.getByLabelText('名稱'), '打到一半');
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await user.click(screen.getByRole('button', { name: '開啟' }));

    expect(screen.getByLabelText('名稱')).toHaveValue('');
  });
});
