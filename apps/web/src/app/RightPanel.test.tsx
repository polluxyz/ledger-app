import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel, RightPanelContent } from './RightPanel';
import { RightPanelProvider } from './RightPanelProvider';
import { useRightPanel } from './right-panel-context';

/**
 * 右側欄的地基（spec 2i §4.2、SC-35、plan D21）。
 *
 * 用一個迷你外殼：`RightPanel`（欄位）＋ 可以切換「這一頁有沒有右側欄」的頁面
 * ＋ 一組操作鈕。驗登記、預設打開、收起的記憶、取消登記、焦點請求，以及收起時
 * 內容不能被 Tab 走到（`inert`）。
 *
 * jsdom 沒有 `matchMedia`，Provider 會當成寬螢幕——抽屜（≤ 900px）的行為在
 * e2e 驗。寬度動畫也一樣只能在瀏覽器裡看，這裡驗的是狀態與屬性。
 */
function Controls() {
  const panel = useRightPanel();
  return (
    <>
      <button onClick={panel.open}>打開</button>
      <button onClick={panel.close}>收起</button>
      <button onClick={panel.requestFocus}>要求焦點</button>
      <output aria-label="焦點請求">{panel.focusRequest}</output>
    </>
  );
}

function Shell({ initiallyWithPanel = true }: { initiallyWithPanel?: boolean }) {
  const [withPanel, setWithPanel] = useState(initiallyWithPanel);
  return (
    <RightPanelProvider>
      <button onClick={() => setWithPanel((value) => !value)}>換頁</button>
      <Controls />
      {withPanel && (
        <RightPanelContent>
          <label>
            金額
            <input />
          </label>
        </RightPanelContent>
      )}
      <RightPanel />
    </RightPanelProvider>
  );
}

function column(): HTMLElement {
  // CSS Modules 在 vitest 裡仍保留原本的類名片段（例如 `_column_1a2b3`）。
  return document.querySelector('[class*="column"]') as HTMLElement;
}

describe('RightPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stays zero-width when no page registers content', () => {
    render(<Shell initiallyWithPanel={false} />);

    expect(column()).not.toHaveAttribute('data-registered');
    expect(column()).not.toHaveAttribute('data-open');
  });

  it('shows the registered content and is open by default', async () => {
    render(<Shell />);

    expect(await screen.findByLabelText('金額')).toBeInTheDocument();
    expect(column()).toHaveAttribute('data-registered');
    expect(column()).toHaveAttribute('data-open');
  });

  it('remembers that the user closed it, across a remount', async () => {
    const user = userEvent.setup();
    const first = render(<Shell />);
    await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '收起' }));

    expect(column()).not.toHaveAttribute('data-open');
    expect(localStorage.getItem('ledger.rightPanelCollapsed')).toBe('true');

    first.unmount();
    render(<Shell />);
    await screen.findByLabelText('金額');
    expect(column()).not.toHaveAttribute('data-open');
  });

  it('forgets the stored value when opened again', async () => {
    localStorage.setItem('ledger.rightPanelCollapsed', 'true');
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '打開' }));

    expect(column()).toHaveAttribute('data-open');
    expect(localStorage.getItem('ledger.rightPanelCollapsed')).toBeNull();
  });

  it('makes the content unreachable by keyboard while closed', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const amount = await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '收起' }));

    expect(amount.closest('[inert]')).not.toBeNull();
  });

  it('unregisters when the page leaves', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '換頁' }));

    expect(screen.queryByLabelText('金額')).not.toBeInTheDocument();
    expect(column()).not.toHaveAttribute('data-registered');
  });

  it('opens and counts up on every focus request', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByLabelText('金額');
    await user.click(screen.getByRole('button', { name: '收起' }));

    await user.click(screen.getByRole('button', { name: '要求焦點' }));
    await user.click(screen.getByRole('button', { name: '要求焦點' }));

    expect(column()).toHaveAttribute('data-open');
    expect(screen.getByLabelText('焦點請求')).toHaveTextContent('2');
  });

  it('refuses to be used outside the provider', () => {
    function Orphan() {
      useRightPanel();
      return null;
    }
    // React 會把拋出的錯誤另外印到 console；這裡只關心有沒有拋。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => render(<Orphan />))).toThrow(/RightPanelProvider/);
    spy.mockRestore();
  });
});
