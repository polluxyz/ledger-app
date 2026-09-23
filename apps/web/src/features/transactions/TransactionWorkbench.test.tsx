import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 右側欄的內容（spec 2i §4.5、SC-35）。2h 時這些案例住在 `HomePage.test.tsx`，
 * 面板抽成 `TransactionWorkbench` 之後跟著搬過來，入口改成 `/transactions`。
 *
 * 驗的是「面板在新增與編輯之間切換、焦點進得去也收得起來」，不是表單本身的欄位
 * 規則——那些由 `features/transactions` 底下的其他測試負責。
 *
 * 策略：從真實的 `App` 出發（它已經包好 `RightPanelProvider`），只把 `fetch` 換成
 * mock，操作一律走鍵盤與滑鼠事件。最重要的一條是**兩張表單不能同時在畫面上**：
 * 它們的欄位標籤一模一樣，同時存在的話 `getByLabelText('金額')` 會對到兩個，
 * 螢幕閱讀器的使用者也分不出在改哪一筆。
 *
 * 面板的內容是 portal 進外殼的，第一次 render 可能晚一拍，所以一律用 `findBy*`。
 */
describe('Transaction workbench in the right panel', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 120,
    date: '2026-08-12T04:00:00.000Z',
    note: '午餐',
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'u1', name: 'Alice' },
    createdAt: '2026-08-12T04:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/transactions');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();

    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions')) {
        return json({ items: [lunch], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/categories')) {
        return json([expenseCategory]);
      }
      if (url.includes('/accounts')) {
        return json([account]);
      }
      return json([ledger]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 整套測試平行跑時，第一個案例要等的東西（帳本、交易列表）可能超過預設的 1 秒。
   * 所有「等畫面出現」的查詢統一放寬到 5 秒，避免偶發的紅字。
   */
  const WAIT = { timeout: 5000 };

  /** 新增表單是一個 `fieldset`，無障礙名稱來自 `<legend>`。 */
  const newForm = () => screen.queryByRole('group', { name: '新增一筆交易' });
  const editPanel = () => screen.queryByRole('dialog', { name: '編輯交易' });
  const findAddForm = () => screen.findByRole('group', { name: '新增一筆交易' }, WAIT);

  /** 等列表載好，再按那一筆的鉛筆鈕；回傳那顆按鈕，好驗焦點有沒有回來。 */
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    const pencil = await screen.findByRole('button', { name: /^編輯/ }, WAIT);
    await user.click(pencil);
    return pencil;
  }

  it('shows the add form in the panel by default', async () => {
    render(<App />);

    expect(await findAddForm()).toBeInTheDocument();
    expect(editPanel()).not.toBeInTheDocument();
  });

  it('replaces the add form with the edit panel when a row is edited', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openEditor(user);

    const panel = editPanel();
    expect(panel).toBeInTheDocument();
    // 面板裡是那一筆的值，不是一張空表單。
    expect(within(panel as HTMLElement).getByLabelText('金額')).toHaveValue(120);
    // 兩張表單互斥：新增的那張讓位給編輯。
    expect(newForm()).not.toBeInTheDocument();
  });

  it('never renders two amount fields at the same time', async () => {
    const user = userEvent.setup();
    render(<App />);

    await findAddForm();
    expect(screen.getAllByLabelText('金額')).toHaveLength(1);

    const pencil = await openEditor(user);
    expect(screen.getAllByLabelText('金額')).toHaveLength(1);

    await user.click(within(editPanel() as HTMLElement).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(newForm()).toBeInTheDocument());
    expect(screen.getAllByLabelText('金額')).toHaveLength(1);
    expect(pencil).toBeInTheDocument();
  });

  it('returns to the add form and to the pencil button on Escape', async () => {
    // 面板是非 modal 的，焦點沒有被鎖住；按 Esc 之後焦點若掉回頁面最上面，
    // 鍵盤使用者得從頭 Tab 一次才回得到原本那一列。
    const user = userEvent.setup();
    render(<App />);

    const pencil = await openEditor(user);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(newForm()).toBeInTheDocument());
    expect(editPanel()).not.toBeInTheDocument();
    expect(pencil).toHaveFocus();
  });

  it('offers a cancel button only while editing', async () => {
    const user = userEvent.setup();
    render(<App />);

    const addForm = await findAddForm();
    // 新增表單是常駐的，沒有東西可以取消。
    expect(within(addForm).queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    await openEditor(user);
    await user.click(within(editPanel() as HTMLElement).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(newForm()).toBeInTheDocument());
    expect(editPanel()).not.toBeInTheDocument();
  });

  // ── 2i 新增：收起與焦點（SC-35.2、SC-35.3） ─────────────────────────────

  it('collapses the panel from the button next to the form title', async () => {
    const user = userEvent.setup();
    render(<App />);

    const addForm = await findAddForm();
    // 收起前，面板的內容對鍵盤是開放的。
    expect(addForm.closest('[inert]')).toBeNull();

    await user.click(screen.getByRole('button', { name: '收起新增面板' }));

    // 收起後右側欄寬度是 0，裡面的欄位必須 `inert`——少了它，鍵盤使用者按 Tab
    // 會走進一個看不見的表單。
    await waitFor(() => expect(addForm.closest('[inert]')).not.toBeNull());
  });

  it('sends the focus to the amount field when the header button asks for it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await findAddForm();
    await user.click(screen.getByRole('button', { name: '新增交易' }));

    expect(screen.getByLabelText('金額')).toHaveFocus();
  });

  it('reopens a collapsed panel and focuses the amount field', async () => {
    const user = userEvent.setup();
    render(<App />);

    const addForm = await findAddForm();
    await user.click(screen.getByRole('button', { name: '收起新增面板' }));
    await waitFor(() => expect(addForm.closest('[inert]')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: '新增交易' }));

    expect(addForm.closest('[inert]')).toBeNull();
    expect(screen.getByLabelText('金額')).toHaveFocus();
  });

  it('never steals the focus just by opening the page', async () => {
    // 面板是常駐的。每次進到記帳頁都把焦點拉進表單，等於奪走使用者的位置——
    // 螢幕閱讀器會從表單開始讀，鍵盤使用者也回不到導覽列。
    render(<App />);

    await findAddForm();

    expect(screen.getByLabelText('金額')).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });
});
