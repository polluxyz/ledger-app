import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RightPanel, RightPanelContent } from './RightPanel';
import { RightPanelProvider } from './RightPanelProvider';
import { useRightPanel } from './right-panel-context';

/**
 * 右側欄的地基（spec 2i §4.2、SC-35、plan D21；第二輪修訂 5：預設關閉、不記憶）。
 *
 * 用一個迷你外殼：`RightPanel`（欄位）＋ 可以切換「這一頁有沒有右側欄」的頁面
 * ＋ 一組操作鈕。驗登記、預設關閉、打開與收起、換頁（網址改變）就關、內容重建
 * （切換帳本）不關、焦點請求，以及收起時內容不能被 Tab 走到（`inert`）。
 *
 * 寬度與滑動的動畫只能在瀏覽器裡看（e2e），這裡驗的是狀態與屬性。
 */
function Controls() {
  const panel = useRightPanel();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={panel.open}>打開</button>
      <button onClick={panel.close}>收起</button>
      <button onClick={panel.requestFocus}>要求焦點</button>
      <button onClick={() => void navigate('/elsewhere')}>換網址</button>
      <button onClick={() => void navigate('/')}>回原網址</button>
      <output aria-label="焦點請求">{panel.focusRequest}</output>
    </>
  );
}

function Shell({ initiallyWithPanel = true }: { initiallyWithPanel?: boolean }) {
  const [withPanel, setWithPanel] = useState(initiallyWithPanel);
  const [generation, setGeneration] = useState(0);
  return (
    <RightPanelProvider>
      {/* 模擬切換帳本：頁面內容以新的 key 整個重建，網址不變。 */}
      <button onClick={() => setGeneration((value) => value + 1)}>重建內容</button>
      <button onClick={() => setWithPanel((value) => !value)}>換頁</button>
      <Controls />
      {withPanel && (
        <RightPanelContent key={generation}>
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

function renderShell(props?: { initiallyWithPanel?: boolean }) {
  return render(
    <MemoryRouter>
      <Shell {...props} />
    </MemoryRouter>,
  );
}

function column(): HTMLElement {
  // CSS Modules 在 vitest 裡仍保留原本的類名片段（例如 `_column_1a2b3`）。
  return document.querySelector('[class*="column"]') as HTMLElement;
}

describe('RightPanel', () => {
  it('stays zero-width when no page registers content', () => {
    renderShell({ initiallyWithPanel: false });

    expect(column()).not.toHaveAttribute('data-registered');
    expect(column()).not.toHaveAttribute('data-open');
  });

  it('holds the registered content but starts closed', async () => {
    renderShell();

    const amount = await screen.findByLabelText('金額');
    expect(column()).toHaveAttribute('data-registered');
    expect(column()).not.toHaveAttribute('data-open');
    // 關著的時候鍵盤走不進去。
    expect(amount.closest('[inert]')).not.toBeNull();
  });

  it('opens and closes on request', async () => {
    const user = userEvent.setup();
    renderShell();
    const amount = await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '打開' }));
    expect(column()).toHaveAttribute('data-open');
    expect(amount.closest('[inert]')).toBeNull();

    await user.click(screen.getByRole('button', { name: '收起' }));
    expect(column()).not.toHaveAttribute('data-open');
  });

  it('does not remember the open state across a remount', async () => {
    const user = userEvent.setup();
    const first = renderShell();
    await screen.findByLabelText('金額');
    await user.click(screen.getByRole('button', { name: '打開' }));

    first.unmount();
    renderShell();
    await screen.findByLabelText('金額');

    expect(column()).not.toHaveAttribute('data-open');
  });

  it('unregisters when the page leaves', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByLabelText('金額');

    await user.click(screen.getByRole('button', { name: '換頁' }));

    expect(screen.queryByLabelText('金額')).not.toBeInTheDocument();
    expect(column()).not.toHaveAttribute('data-registered');
  });

  it('closes when the address changes', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByLabelText('金額');
    await user.click(screen.getByRole('button', { name: '打開' }));

    await user.click(screen.getByRole('button', { name: '換網址' }));

    expect(column()).not.toHaveAttribute('data-open');
  });

  it('is closed again after leaving and coming back (SC-44)', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByLabelText('金額');
    await user.click(screen.getByRole('button', { name: '打開' }));

    await user.click(screen.getByRole('button', { name: '換網址' }));
    await user.click(screen.getByRole('button', { name: '回原網址' }));

    expect(column()).not.toHaveAttribute('data-open');
  });

  it('stays open when the content is rebuilt on the same page (switching ledgers)', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByLabelText('金額');
    await user.click(screen.getByRole('button', { name: '打開' }));

    await user.click(screen.getByRole('button', { name: '重建內容' }));

    await screen.findByLabelText('金額');
    expect(column()).toHaveAttribute('data-open');
  });

  it('opens and counts up on every focus request', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByLabelText('金額');

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
