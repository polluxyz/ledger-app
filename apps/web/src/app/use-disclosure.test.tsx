import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useDisclosure } from './use-disclosure';

/**
 * 浮動選單的開闔行為（2f · D7）。
 *
 * 這四條測的都是「使用者以為會發生的事」，而不是實作細節：按一下開、再按一下關、
 * 點旁邊就收起來、按 Esc 收起而且焦點不會不見。
 */

/**
 * 測試用的最小宿主。面板**一直在 DOM 裡**，只有 `aria-expanded` 會變——
 * 這與 `AppSidebar` 的實際做法一致（D6：一份 DOM，由 CSS 決定形態）。
 */
function Harness() {
  const { triggerProps, panelProps } = useDisclosure();

  return (
    <div>
      <button type="button" {...triggerProps}>
        選單
      </button>
      <nav {...panelProps} aria-label="測試選單">
        <a href="/">首頁</a>
      </nav>
      <p>面板外面的內容</p>
    </div>
  );
}

function trigger() {
  return screen.getByRole('button', { name: '選單' });
}

describe('useDisclosure', () => {
  it('opens on the first click and closes on the second', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    // 再點一次收起。這一條最容易寫壞——document 上的 pointerdown 若沒有把
    // 觸發鈕本身排除掉，會先關再開，看起來像「按了沒反應」。
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the user clicks outside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByText('面板外面的內容'));
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the panel open while the user interacts inside it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.click(screen.getByRole('navigation', { name: '測試選單' }));

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    // 先把焦點移進面板，Esc 之後的焦點斷言才有意義——
    // 停在按鈕上按 Esc 的話，焦點本來就沒動過。
    await user.tab();
    expect(screen.getByRole('link', { name: '首頁' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });
});
