import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';

/**
 * 設定彈窗（2i · SC-32.2、SC-32.3，第二輪修訂）。
 *
 * 驗四件事：彈窗是名稱「設定」的 modal `dialog`、外觀是三張 `role="radio"` 的卡片
 * 且 `aria-checked` 跟著偏好走、選了之後**真的換主題**（`<html data-theme>` 與
 * localStorage 是唯一真相，不是 React state）、以及鍵盤與關閉的四條路徑。
 *
 * 策略：直接渲染這個元件，不經過 `<App />`。它只依賴 `useTheme`（純本地狀態），
 * 沒有 Router、react-query 或 AuthProvider 的牽連，包一層反而測到別人的東西。
 * 「焦點關閉後回到使用者觸發鈕」屬於 `UserMenu` 的接線，在那一份測。
 *
 * ⚠️ jsdom 不實作 `<dialog>` 的 Esc 行為（`showModal` 的替身在 `test/setup.ts`），
 * 所以 Esc 那一條改送 `close` 事件——那正是瀏覽器按下 Esc 最終會發出的東西。
 */
describe('SettingsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  function appearanceGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '外觀' });
  }

  it('opens as a modal dialog named 設定', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    // 只加 open 屬性不會有遮罩與焦點鎖定，必須真的呼叫 showModal()。
    expect(showModal).toHaveBeenCalled();
    // 版面是為了之後還會加設定而留的，說明文字本身就是那個承諾。
    expect(screen.getByText('之後的設定也會放在這裡。')).toBeInTheDocument();
  });

  it('renders three appearance cards with the current one checked', () => {
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(within(appearanceGroup()).getAllByRole('radio')).toHaveLength(3);

    // 沒選過就是「跟隨系統」，其餘兩張沒被選。
    expect(screen.getByRole('radio', { name: '跟隨系統' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '淺色' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '深色' })).not.toBeChecked();
  });

  it('applies and remembers the chosen appearance', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: '淺色' }));

    // 畫面顏色的唯一來源是 `<html data-theme>`，不是 React state（2h D19）。
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('ledger.theme')).toBe('light');
    expect(screen.getByRole('radio', { name: '淺色' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '跟隨系統' })).not.toBeChecked();
  });

  /**
   * roving tabindex：方向鍵移動**並且**選取（與原生 radio 群組同樣的行為），
   * 而且只有被選中的那張留在 Tab 順序裡。
   */
  it('moves to the next card with the arrow keys and selects it', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    screen.getByRole('radio', { name: '跟隨系統' }).focus();
    await user.keyboard('{ArrowRight}');

    const light = screen.getByRole('radio', { name: '淺色' });
    expect(light).toHaveFocus();
    expect(light).toBeChecked();
    expect(light).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '跟隨系統' })).toHaveAttribute('tabindex', '-1');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('wraps around from the last card back to the first', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: '深色' }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: '跟隨系統' })).toBeChecked();
    // 「跟隨系統」是把屬性**移除**，不是設成 system（2h D19）。
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);

    // jsdom 不會把 Esc 轉成 dialog 的關閉行為，所以直接送 close 事件。
    fireEvent(screen.getByRole('dialog', { name: '設定' }), new Event('close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '關閉' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * 點背景（`::backdrop`）關閉。遮罩不是獨立節點，點在上面時事件的 target 就是
   * `<dialog>` 本身，所以這裡直接對外框送 click；點在卡片上則不該關。
   */
  it('closes when the user clicks the backdrop but not the content', () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog', { name: '設定' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(<SettingsDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
