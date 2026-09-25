import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 首頁 dashboard（spec 2i SC-34.1、假設 8、9、13）。
 *
 * 這一檔驗的是「首頁變成摘要」這件事：統計卡、最近 5 筆、兩個入口連結，以及
 * **不該出現的東西**——篩選列與分頁都搬到 `/transactions` 了。面板本身的行為
 * 由 `features/transactions/TransactionWorkbench.test.tsx` 負責。
 *
 * 訪客狀態刻意一併釘住：2i 只改登入後的版面，未登入的首頁一個字都不該變
 * （假設 13）。
 *
 * 策略：從真實的 `App` 出發，只把 `fetch` 換成 mock。右側欄的內容是 portal 進
 * 外殼的，第一次 render 可能晚一拍，所以一律用 `findBy*`。
 */
describe('Home dashboard', () => {
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
  let incomingLinkInvites: unknown[] = [];
  let incomingProposals: unknown[] = [];

  /** 七筆交易：後端若多給了，卡片仍然只顯示 5 筆。 */
  const transactions = Array.from({ length: 7 }, (_, index) => ({
    id: `txn-${index + 1}`,
    type: 'EXPENSE',
    amount: 100 + index,
    date: '2026-08-12T04:00:00.000Z',
    note: `第 ${index + 1} 筆`,
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'u1', name: 'Alice' },
    debt: null,
    createdAt: '2026-08-12T04:00:00.000Z',
  }));

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    incomingLinkInvites = [];
    incomingProposals = [];

    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions')) {
        return json({ items: transactions, page: 1, limit: 5, total: 7 });
      }
      if (url.includes('/friend-requests?')) {
        return json({
          items: incomingLinkInvites,
          page: 1,
          limit: 20,
          total: incomingLinkInvites.length,
        });
      }
      if (url.includes('/debt-proposals?')) {
        return json({
          items: incomingProposals,
          page: 1,
          limit: 20,
          total: incomingProposals.length,
        });
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

  const WAIT = { timeout: 5000 };

  function signIn() {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
  }

  /**
   * 最近交易卡自成一個 region，查詢限定在它裡面才不會抓到帳戶餘額那張卡。
   *
   * 卡片本身比交易資料先出現（先畫「載入中…」）。只等卡片的話，後面的同步查詢
   * 可能撞上還在載入的那一瞬間——CPU 忙時大約六次錯一次（2i W6 找到的偶發失敗）。
   * 所以一併等到「載入中…」消失才交出去。
   */
  const recentCard = async () => {
    const region = await screen.findByRole('region', { name: '最近交易' }, WAIT);
    await waitFor(
      () => expect(within(region).queryByText('載入中…')).not.toBeInTheDocument(),
      WAIT,
    );
    return within(region);
  };

  // ── 訪客（假設 13：一個字都不變） ─────────────────────────────────────────

  it('keeps the guest home page exactly as it was', async () => {
    const user = userEvent.setup();

    render(<App />);

    // 統計卡是空狀態示意，固定 0，不做任何計算。
    expect(screen.getAllByText('$0')).toHaveLength(3);
    expect(screen.getByText(/登入後即可開始記帳/)).toBeInTheDocument();
    // dashboard 的東西一樣都不該出現。
    expect(screen.queryByRole('region', { name: '最近交易' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '帳戶餘額' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '註冊' }));
    expect(await screen.findByRole('dialog', { name: '註冊' }, WAIT)).toBeInTheDocument();
  });

  // ── 登入後的 dashboard ───────────────────────────────────────────────────

  it('shows the three placeholder stat cards', async () => {
    signIn();

    render(<App />);

    // 正確的數字要由後端彙總端點提供；拿當頁交易自己加總只會算出錯的值。
    expect(await screen.findAllByText('即將推出', undefined, WAIT)).toHaveLength(3);
    for (const label of ['本月支出', '本月收入', '結餘']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('places the pending card before the stat cards when items are waiting', async () => {
    signIn();
    incomingLinkInvites = [
      {
        id: 'invite-1',
        direction: 'incoming',
        status: 'PENDING',
        counterpart: { userId: 'user-2', name: '王小明', email: null },
        forLink: true,
        counterpartyId: null,
        createdAt: '2026-09-25T00:00:00.000Z',
        respondedAt: null,
      },
    ];

    render(<App />);

    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);
    const firstStat = (await screen.findAllByText('即將推出', undefined, WAIT))[0]!;
    expect(card.compareDocumentPosition(firstStat) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('does not place an empty pending card on the home page', async () => {
    signIn();

    render(<App />);

    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    await screen.findAllByText('即將推出', undefined, WAIT);
    await waitFor(
      () => expect(screen.queryByRole('region', { name: '待確認' })).not.toBeInTheDocument(),
      WAIT,
    );
  });

  it('shows only the five most recent transactions', async () => {
    signIn();

    render(<App />);

    const card = await recentCard();
    expect(card.getAllByRole('listitem')).toHaveLength(5);
    expect(card.getByText('第 1 筆')).toBeInTheDocument();
    expect(card.queryByText('第 6 筆')).not.toBeInTheDocument();

    // 「最近」是後端的事，所以請求要把 5 帶過去。
    const listCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/transactions'));
    expect(listCall).toContain('limit=5');
  });

  it('links on to the full transaction list and to the accounts page', async () => {
    signIn();

    render(<App />);

    expect((await recentCard()).getByRole('link', { name: '查看全部' })).toHaveAttribute(
      'href',
      '/transactions',
    );
    const balances = within(screen.getByRole('region', { name: '帳戶餘額' }));
    expect(balances.getByRole('link', { name: '管理' })).toHaveAttribute('href', '/accounts');
  });

  it('opens the edit panel when a recent transaction is clicked', async () => {
    // 摘要卡上沒有鉛筆與垃圾桶（假設 8）：整列就是「編輯這一筆」，刪除要到交易頁。
    const user = userEvent.setup();
    signIn();

    render(<App />);

    const card = await recentCard();
    expect(card.queryByRole('button', { name: /^編輯/ })).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();

    await user.click(card.getByRole('button', { name: /第 1 筆/ }));

    const panel = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(panel).getByLabelText('金額')).toHaveValue(100);
  });

  it('opens the edit panel from the keyboard as well', async () => {
    // 整列是一顆真正的 `<button>`，所以 Enter 就能開——不必自己補 tabIndex 與
    // keydown，也不會漏掉 Space。
    const user = userEvent.setup();
    signIn();

    render(<App />);

    const card = await recentCard();
    const row = card.getByRole('button', { name: /第 2 筆/ });
    row.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
  });

  it('never opens the edit panel for a debt transaction', async () => {
    /*
     * 借還交易（3b spec §7）在一般交易端點是唯讀的，摘要卡上那一列因此不是按鈕。
     * 測試刻意在同一份清單裡放一筆支出：先確認點借還那列什麼都沒發生，再點支出
     * 那列把面板叫出來——否則「面板沒開」可能只是因為整張卡根本還沒載好。
     */
    const user = userEvent.setup();
    signIn();
    const lend = {
      ...transactions[0],
      id: 'txn-lend',
      type: 'LEND',
      amount: 1000,
      category: null,
      note: '借小明',
      debt: {
        entryId: 'entry-1',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
      },
    };
    const expense = { ...transactions[1], id: 'txn-expense', note: '午餐' };
    const paidExpense = {
      ...transactions[2],
      id: 'txn-paid',
      note: '代付晚餐',
      debt: {
        entryId: 'entry-paid',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
      },
    };
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions')) {
        return json({ items: [lend, expense, paidExpense], page: 1, limit: 5, total: 3 });
      }
      if (url.includes('/categories')) {
        return json([expenseCategory]);
      }
      if (url.includes('/accounts')) {
        return json([account]);
      }
      return json([ledger]);
    });

    render(<App />);

    const card = await recentCard();
    // 借出的錢從帳戶出去，記負號；名稱是「借出」，不是沒有分類就寫的「轉帳」。
    expect(card.getByText('-$1,000')).toBeInTheDocument();
    expect(card.getByText('借出')).toBeInTheDocument();
    expect(card.queryByText('轉帳')).not.toBeInTheDocument();
    // 沒有東西可以開，那一列就不該是按鈕。
    expect(card.queryByRole('button', { name: /借小明/ })).not.toBeInTheDocument();

    await user.click(card.getByText('借小明'));
    expect(screen.queryByRole('dialog', { name: '編輯交易' })).not.toBeInTheDocument();

    // 首頁沒有打開對象往來帳的入口，代付支出也以靜態列呈現。
    expect(card.queryByRole('button', { name: /代付晚餐/ })).not.toBeInTheDocument();
    await user.click(card.getByText('代付晚餐'));
    expect(screen.queryByRole('dialog', { name: '編輯交易' })).not.toBeInTheDocument();

    await user.click(card.getByRole('button', { name: /午餐/ }));
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
  });

  it('reads each row the same way the transactions page does', async () => {
    /*
     * e2e 有好幾個情境是拿「-$120 那一列」找到交易，再讀它的備註與帳戶。那些情境
     * 在 dashboard 上完成（這裡同時有最近交易、新增表單與帳戶餘額），所以一列的
     * 文字必須與交易頁的列一致：分類、備註、帳戶、同一套金額格式。
     */
    signIn();
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions')) {
        return json({
          items: [
            transactions[0],
            { ...transactions[1], type: 'INCOME', amount: 5000, note: '薪水' },
            {
              ...transactions[2],
              type: 'TRANSFER',
              amount: 500,
              category: null,
              note: '提款',
              toAccount: { id: 'acc-2', name: '國泰世華' },
            },
            // 共享帳本裡別人的帳戶會被後端遮成 null，那一格就留白。
            { ...transactions[3], account: null, note: '別人記的' },
          ],
          page: 1,
          limit: 5,
          total: 4,
        });
      }
      if (url.includes('/accounts')) {
        return json([account]);
      }
      if (url.includes('/categories')) {
        return json([expenseCategory]);
      }
      return json([ledger]);
    });

    render(<App />);

    const card = await recentCard();
    const rows = card.getAllByRole('listitem');
    // 整頁的 `<li>` 只有這五列以內的交易，e2e 才數得準。
    expect(screen.getAllByRole('listitem')).toHaveLength(rows.length);

    // 支出帶負號、收入帶正號、轉帳不帶號（錢只是換了帳戶）。
    expect(within(rows[0] as HTMLElement).getByText('-$100')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('餐飲')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('第 1 筆')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('現金');

    expect(within(rows[1] as HTMLElement).getByText('+$5,000')).toBeInTheDocument();

    const transferRow = rows[2] as HTMLElement;
    expect(within(transferRow).getByText('$500')).toBeInTheDocument();
    expect(within(transferRow).getByText('轉帳')).toBeInTheDocument();
    expect(transferRow).toHaveTextContent('現金 → 國泰世華');

    // 帳戶被遮蔽的那一列留白，其餘照常顯示。
    expect(rows[3]).not.toHaveTextContent('現金');
    expect(rows[3]).toHaveTextContent('別人記的');
  });

  it('puts the ledger switcher and the add button in the page toolbar', async () => {
    // SC-38.2、SC-38.3：切換器在橫條左邊、「＋ 新增交易」在橫條右邊。
    // 判準刻意不看 CSS 類名：橫條在中間區的最上方、頁面標題列之外，所以它裡面的
    // 東西一定不在 `<header>` 裡，而且在 DOM 順序上排在標題之前。
    signIn();

    render(<App />);

    const addButton = await screen.findByRole('button', { name: '新增交易' }, WAIT);
    const heading = screen.getByRole('heading', { name: '總覽' });

    expect(addButton.closest('header')).toBeNull();
    expect(addButton.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );

    // 只有一本帳本，切換器是純文字而不是下拉（SC-33.2）。
    const switcher = screen.getByText('我的帳本');
    expect(switcher.closest('header')).toBeNull();
    expect(switcher.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );

    // SC-38.5：標題上方不再有任何一行字。
    expect(heading.closest('header')?.firstElementChild).toBe(heading);
  });

  it('leaves the filters and the pager on the transactions page', async () => {
    signIn();

    render(<App />);

    await recentCard();
    expect(screen.queryByRole('region', { name: '篩選交易' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '分頁' })).not.toBeInTheDocument();
  });
});
