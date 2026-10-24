import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StatisticsGroup } from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';
import {
  HOME_CATEGORY_COLORS_STORAGE_KEY,
  homeCategoryColor,
  resetHomeCategoryColorsForTests,
} from './use-home-category-colors';

/**
 * 設定彈窗（2i · SC-32.2、SC-32.3，第二輪修訂）。
 *
 * 「動畫」與「首頁分類條配色」都要保留各自的選擇；分類配色使用可訂閱 store，並以
 * 示意分類確認三種預覽色由目前圖表主題計算。
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
    resetHomeCategoryColorsForTests();
    document.documentElement.removeAttribute('data-theme');
    // 動畫開關與深淺色一樣，唯一真相是 `<html>` 上的屬性——一個測試關掉之後
    // 不清掉，下一個測試就會從「已經關了」開始。
    document.documentElement.removeAttribute('data-motion');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function appearanceGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '外觀' });
  }

  function homeCategoryColorGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: '首頁分類條配色' });
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

  it('renders three home category color cards with only the selected card in the Tab order', () => {
    render(<SettingsDialog open onClose={vi.fn()} />);

    const group = homeCategoryColorGroup();
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '彩色' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '彩色' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '金色' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: '灰色' })).toHaveAttribute('tabindex', '-1');
  });

  it('changes home category color with the arrow keys and persists the selection', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    screen.getByRole('radio', { name: '彩色' }).focus();
    await user.keyboard('{ArrowRight}');

    const gold = screen.getByRole('radio', { name: '金色' });
    expect(gold).toHaveFocus();
    expect(gold).toBeChecked();
    expect(gold).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '彩色' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: '灰色' })).toHaveAttribute('tabindex', '-1');
    expect(localStorage.getItem(HOME_CATEGORY_COLORS_STORAGE_KEY)).toBe('gold');
  });

  it('shows each color preview using its mode and the current chart theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<SettingsDialog open onClose={vi.fn()} />);

    const previewGroup: StatisticsGroup = {
      kind: 'CATEGORY',
      category: { id: 'settings-preview', name: '示意分類', icon: null },
      amount: 0,
      percentageBps: 0,
    };
    const options = [
      { mode: 'color' as const, label: '彩色' },
      { mode: 'gold' as const, label: '金色' },
      { mode: 'gray' as const, label: '灰色' },
    ];

    for (const option of options) {
      const preview = within(screen.getByRole('radio', { name: option.label })).getByTestId(
        'category-color-preview',
      );
      const expected = document.createElement('span');
      expected.style.backgroundColor = homeCategoryColor(previewGroup, option.mode, 'dark');
      expect(preview.style.backgroundColor).toBe(expected.style.backgroundColor);
    }
  });

  it('switches color mode without making API requests', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsDialog open onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: '灰色' }));

    expect(localStorage.getItem(HOME_CATEGORY_COLORS_STORAGE_KEY)).toBe('gray');
    expect(fetchMock).not.toHaveBeenCalled();
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

  /**
   * 動畫開關（SC-39）。預設開，而且旁邊那行說明要在——使用者得先知道關掉會怎樣，
   * 才有辦法決定要不要關。
   */
  it('offers an animation switch that starts on', () => {
    render(<SettingsDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('switch', { name: '動畫' })).toBeChecked();
    expect(screen.getByText('關閉後，側欄與右側欄的開合會直接切換。')).toBeInTheDocument();
  });

  it('turns animation off and back on, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={vi.fn()} />);

    await user.click(screen.getByRole('switch', { name: '動畫' }));

    // 與深淺色同一個慣例：畫面的唯一來源是 `<html>` 的屬性，不是 React state。
    expect(document.documentElement).toHaveAttribute('data-motion', 'off');
    expect(localStorage.getItem('ledger.motion')).toBe('off');
    expect(screen.getByRole('switch', { name: '動畫' })).not.toBeChecked();

    await user.click(screen.getByRole('switch', { name: '動畫' }));

    // 「開」是預設值，所以是把屬性與那一筆 localStorage 都**移除**，不是存 'on'。
    expect(document.documentElement).not.toHaveAttribute('data-motion');
    expect(localStorage.getItem('ledger.motion')).toBeNull();
    expect(screen.getByRole('switch', { name: '動畫' })).toBeChecked();
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
