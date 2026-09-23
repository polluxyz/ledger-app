import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideDown } from './SlideDown';

/**
 * 往下展開的容器（phase-2h SC-30）。
 *
 * 動畫本身 jsdom 看不到，這裡驗的是動畫前後的「生命週期」：展開時內容在、
 * 收起後內容被卸載、再打開是乾淨的。收起分兩條路各驗一次——有動畫時等
 * transitionend（或保險計時器），要求減少動態效果時立刻卸載。
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        建立帳本
      </button>
      <SlideDown open={open}>
        <input aria-label="名稱" />
      </SlideDown>
    </>
  );
}

/** 讓 matchMedia 回報「使用者沒有要求減少動態效果」，走有動畫的那條路。 */
function allowMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
}

describe('SlideDown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders nothing while closed', () => {
    render(<Harness />);

    expect(screen.queryByLabelText('名稱')).not.toBeInTheDocument();
  });

  it('shows its content once opened', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '建立帳本' }));

    expect(screen.getByLabelText('名稱')).toBeInTheDocument();
  });

  it('unmounts right away when the user prefers reduced motion', async () => {
    // jsdom 沒有 matchMedia，元件把它當成「不要動畫」——與使用者真的要求時同一條路。
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: '建立帳本' });

    await user.click(toggle);
    await user.click(toggle);

    expect(screen.queryByLabelText('名稱')).not.toBeInTheDocument();
  });

  it('keeps the content until the closing transition ends', () => {
    allowMotion();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: '建立帳本' });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    // 收起動畫還在播，內容要留著——立刻拿掉的話使用者只會看到它「啪」地消失。
    const input = screen.getByLabelText('名稱');
    fireEvent.transitionEnd(input.parentElement!.parentElement!);

    expect(screen.queryByLabelText('名稱')).not.toBeInTheDocument();
  });

  it('still unmounts if the transition never reports back', () => {
    allowMotion();
    vi.useFakeTimers();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: '建立帳本' });

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByLabelText('名稱')).not.toBeInTheDocument();
  });

  it('starts from a clean slate when reopened', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: '建立帳本' });

    await user.click(toggle);
    await user.type(screen.getByLabelText('名稱'), '打到一半');
    await user.click(toggle);
    await user.click(toggle);

    expect(screen.getByLabelText('名稱')).toHaveValue('');
  });
});
