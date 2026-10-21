import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { toDateInputValue } from '../../lib/format';

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
  const targetLedger = {
    ...ledger,
    id: 'ledger-2',
    name: '另一個帳本',
  };
  const emptyCategoryLedger = {
    ...ledger,
    id: 'ledger-3',
    name: '沒有同名分類',
  };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 88000 };
  const otherAccount = { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 125000 };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 12000,
    date: '2026-08-12T04:00:00.000Z',
    note: '午餐',
    title: '便當',
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'u1', name: 'Alice' },
    createdAt: '2026-08-12T04:00:00.000Z',
  };
  const mePerson = { id: 'person-me', name: 'Alice', userId: 'u1', status: 'MEMBER' };
  const mingPerson = { id: 'person-ming', name: '小明', userId: 'u2', status: 'MEMBER' };
  let ledgers = [ledger];
  let listedTransaction: Record<string, unknown> = lunch;
  const createdTransactions: { url: string; body: unknown }[] = [];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/transactions');
    ledger.kind = 'PERSONAL';
    ledger.role = 'OWNER';
    ledgers = [ledger];
    listedTransaction = lunch;
    createdTransactions.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();

    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/transactions') && options?.method === 'POST') {
        createdTransactions.push({
          url,
          body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
        });
        return json({ ...lunch, id: 'txn-created' });
      }
      if (url.endsWith('/transactions/txn-1') && options?.method === 'PATCH') {
        return json(lunch);
      }
      if (url.includes('/people')) return json([mePerson, mingPerson]);
      if (url.endsWith('/users/me')) {
        return json({ id: 'u1', email: 'alice@example.test', name: 'Alice' });
      }
      if (url.includes('/transactions')) {
        return json({ items: [listedTransaction], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/categories')) {
        if (url.includes('/ledgers/ledger-2/categories')) {
          return json([{ ...expenseCategory, id: 'cat-2' }]);
        }
        if (url.includes('/ledgers/ledger-3/categories')) return json([]);
        return json([expenseCategory]);
      }
      if (url.includes('/accounts')) {
        return json([account, otherAccount]);
      }
      return json(ledgers);
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

    const form = await findAddForm();
    expect(form).toBeInTheDocument();
    expect(within(form).queryByLabelText('帳本')).not.toBeInTheDocument();
    expect(editPanel()).not.toBeInTheDocument();
  });

  it('copies a personal transaction with its account and uses today as the date', async () => {
    const user = userEvent.setup();
    listedTransaction = lunch;
    render(<App />);

    const moreButton = await screen.findByRole('button', { name: /更多交易動作/ }, WAIT);
    await user.click(moreButton);
    await user.click(screen.getByRole('menuitem', { name: '複製' }));

    const form = await findAddForm();
    expect(within(form).getByLabelText('帳本')).toHaveValue('ledger-1');
    expect(within(form).getByLabelText('日期')).toHaveValue(toDateInputValue());
    expect(within(form).getByLabelText('金額')).toHaveValue(120);
    expect(within(form).getByLabelText('帳戶')).toHaveValue('acc-1');
    expect(within(form).getByLabelText('名稱')).toHaveValue('便當');
    expect(within(form).getByLabelText('備註')).toHaveValue('午餐');
  });

  it('copies both accounts from a transfer', async () => {
    const user = userEvent.setup();
    listedTransaction = {
      ...lunch,
      type: 'TRANSFER',
      category: null,
      toAccount: { id: otherAccount.id, name: otherAccount.name },
    };
    render(<App />);

    const moreButton = await screen.findByRole('button', { name: /更多交易動作/ }, WAIT);
    await user.click(moreButton);
    await user.click(screen.getByRole('menuitem', { name: '複製' }));

    const form = await findAddForm();
    expect(within(form).getByRole('button', { name: '轉帳' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByLabelText('轉出帳戶')).toHaveValue('acc-1');
    expect(within(form).getByLabelText('轉入帳戶')).toHaveValue('acc-2');
  });

  it('copies a shared transaction, maps its category, clears split people after changing ledger, and posts to that ledger', async () => {
    const user = userEvent.setup();
    ledger.kind = 'SHARED';
    const sharedTransaction = {
      ...lunch,
      account: null,
      payer: mingPerson,
      ledgerSplit: {
        method: 'EQUAL',
        precision: 'CENT',
        shares: [
          { person: mePerson, share: 6000, ratio: null },
          { person: mingPerson, share: 6000, ratio: null },
        ],
      },
    };
    listedTransaction = sharedTransaction;
    ledgers = [ledger, targetLedger, emptyCategoryLedger];
    render(<App />);

    const moreButton = await screen.findByRole('button', { name: /更多交易動作/ }, WAIT);
    await user.click(moreButton);
    await user.click(screen.getByRole('menuitem', { name: '複製' }));

    let form = await findAddForm();
    expect(within(form).getByLabelText('帳本')).toHaveValue('ledger-1');
    expect(within(form).getByRole('button', { name: '支出' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByLabelText('金額')).toHaveValue(120);
    expect(within(form).getByLabelText('日期')).toHaveValue(toDateInputValue());
    expect(within(form).getByRole('combobox', { name: '分類' })).toHaveAttribute(
      'aria-valuetext',
      '餐飲',
    );
    expect(within(form).getByLabelText('名稱')).toHaveValue('便當');
    expect(within(form).getByLabelText('備註')).toHaveValue('午餐');
    expect(within(form).getByLabelText('付款人')).toHaveValue('小明');
    expect(within(form).getByRole('checkbox', { name: '分帳' })).toBeChecked();

    await user.selectOptions(within(form).getByLabelText('帳本'), 'ledger-3');
    form = await findAddForm();
    await waitFor(() =>
      expect(within(form).getByRole('combobox', { name: '分類' })).toHaveAttribute(
        'aria-valuetext',
        '請選擇分類',
      ),
    );
    expect(within(form).queryByLabelText('付款人')).not.toBeInTheDocument();
    const splitCheckbox = within(form).getByRole('checkbox', { name: '分帳' });
    expect(splitCheckbox).not.toBeChecked();
    expect(within(form).queryByText('小明')).not.toBeInTheDocument();

    await user.selectOptions(within(form).getByLabelText('帳本'), 'ledger-2');
    form = await findAddForm();
    await waitFor(() =>
      expect(within(form).getByRole('combobox', { name: '分類' })).toHaveAttribute(
        'aria-valuetext',
        '餐飲',
      ),
    );
    await user.click(within(form).getByRole('button', { name: '新增' }));

    await waitFor(() => expect(createdTransactions).toHaveLength(1), WAIT);
    expect(createdTransactions[0]?.url).toContain('/ledgers/ledger-2/transactions');
    expect(createdTransactions[0]?.body).toMatchObject({
      type: 'EXPENSE',
      amount: 12000,
      categoryId: 'cat-2',
      accountId: 'acc-1',
      title: '便當',
      note: '午餐',
    });
    expect(createdTransactions[0]?.body).not.toHaveProperty('payerPersonId');
    expect(createdTransactions[0]?.body).not.toHaveProperty('ledgerSplit');
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
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    // 收起後留著的是編輯面板（inert），新增表單沒有回來，所以金額欄仍只有一個。
    expect(editPanel()?.closest('[inert]')).not.toBeNull();
    expect(screen.getAllByLabelText('金額')).toHaveLength(1);
    expect(pencil).toBeInTheDocument();
  });

  it('collapses the side panel and restores focus to the pencil button on Escape', async () => {
    // 面板是非 modal 的，焦點沒有被鎖住；按 Esc 之後焦點若掉回頁面最上面，
    // 鍵盤使用者得從頭 Tab 一次才回得到原本那一列。
    const user = userEvent.setup();
    render(<App />);

    const pencil = await openEditor(user);
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57），而不是換成新增表單。
    expect(editPanel()?.closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
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

    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57），而不是換成新增表單。
    expect(editPanel()?.closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });

  it('collapses the side panel after a successful ordinary transaction save', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openEditor(user);
    const panel = editPanel() as HTMLElement;
    const amount = within(panel).getByLabelText('金額');
    await user.clear(amount);
    await user.type(amount, '200');
    await user.click(within(panel).getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/transactions/txn-1') &&
            (options as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true);
    }, WAIT);
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57），而不是換成新增表單。
    expect(editPanel()?.closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });

  // ── 2i 新增：收起與焦點（SC-35.2、SC-35.3） ─────────────────────────────

  it('collapses the panel from the button next to the form title', async () => {
    const user = userEvent.setup();
    render(<App />);

    const addForm = await findAddForm();
    // 右側欄預設關閉（spec 2i 第二輪修訂 5），先打開。
    await user.click(screen.getByRole('button', { name: '新增交易' }));
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
