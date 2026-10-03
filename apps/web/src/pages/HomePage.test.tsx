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
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 88000 };
  let incomingLinkInvites: unknown[] = [];
  let incomingProposals: unknown[] = [];

  /** 七筆交易：後端若多給了，卡片仍然只顯示 5 筆。 */
  const transactions = Array.from({ length: 7 }, (_, index) => ({
    id: `txn-${index + 1}`,
    type: 'EXPENSE',
    amount: (100 + index) * 100,
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
      if (url.includes('/counterparties?')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
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
    expect(card.getAllByText('餐飲')).toHaveLength(5);
    expect(card.queryByText('第 1 筆')).not.toBeInTheDocument();
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

  it('opens the edit panel when clicked and collapses the dashboard side panel on close', async () => {
    // 摘要卡上沒有鉛筆與垃圾桶（假設 8）：整列就是「編輯這一筆」，刪除要到交易頁。
    const user = userEvent.setup();
    signIn();

    render(<App />);

    const card = await recentCard();
    expect(card.getAllByRole('button', { name: /^編輯/ })).toHaveLength(5);
    expect(card.queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();

    await user.click(card.getAllByRole('button', { name: /^編輯/ })[0]!);

    const panel = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(panel).getByLabelText('金額')).toHaveValue(100);
    await user.click(within(panel).getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57）：它在 inert 裡，而且沒有換成新增表單。
    expect(screen.getByRole('dialog', { name: '編輯交易' }).closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });

  it('opens the edit panel from the keyboard as well', async () => {
    // 整列是一顆真正的 `<button>`，所以 Enter 就能開——不必自己補 tabIndex 與
    // keydown，也不會漏掉 Space。
    const user = userEvent.setup();
    signIn();

    render(<App />);

    const card = await recentCard();
    const row = card.getAllByRole('button', { name: /餐飲/ })[1]!;
    row.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
  });

  it('edits linked debt transactions from recent activity while leaving other peoples debt rows read-only', async () => {
    /*
     * 自己的往來紀錄可從首頁直接編輯；其他人的借還交易沒有 entryId，維持純展示。
     */
    const user = userEvent.setup();
    signIn();
    const lend = {
      ...transactions[0],
      id: 'txn-lend',
      type: 'LEND',
      amount: 100000,
      category: null,
      note: '借小明',
      debt: {
        entryId: 'entry-1',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
        paired: false,
        note: null,
      },
    };
    const otherLend = {
      ...lend,
      id: 'txn-other-lend',
      amount: 50000,
      note: '他人借出',
      debt: null,
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
        paired: false,
        note: null,
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
        return json({
          items: [lend, otherLend, expense, paidExpense],
          page: 1,
          limit: 5,
          total: 4,
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

    render(<App />);

    const card = await recentCard();
    // 借出的錢從帳戶出去，記負號；名稱是「借出」，不是沒有分類就寫的「轉帳」。
    expect(card.getByText('-$1,000')).toBeInTheDocument();
    expect(card.getByText('借出 · 小明')).toBeInTheDocument();
    expect(card.getByText('借出', { exact: true })).toBeInTheDocument();
    expect(card.queryByText('轉帳')).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: /借出/ })).toBeInTheDocument();

    await user.click(card.getByText('借出 · 小明'));
    const debtEditor = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(debtEditor).getByText('借出 · 小明')).toBeInTheDocument();
    expect(within(debtEditor).getByLabelText('金額')).toHaveValue(1000);
    await user.click(within(debtEditor).getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);

    expect(card.queryByText('他人借出')).not.toBeInTheDocument();
    await user.click(card.getByText('借出', { exact: true }));
    // 別人的借還列不可點：右側欄維持收起（收起的面板裡仍留著上一筆，見 W57）。
    expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');

    expect(card.getAllByText('餐飲')).toHaveLength(2);
    await user.click(card.getAllByRole('button', { name: /編輯.*餐飲/ })[1]!);
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '關閉' }));

    await user.click(card.getAllByRole('button', { name: /編輯.*餐飲/ })[0]!);
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
  });

  it('uses the same compact transaction rows as the transactions page', async () => {
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
            { ...transactions[1], type: 'INCOME', amount: 500000, note: '薪水' },
            {
              ...transactions[2],
              type: 'TRANSFER',
              amount: 50000,
              category: null,
              note: '提款',
              toAccount: { id: 'acc-2', name: '國泰世華' },
            },
            {
              ...transactions[3],
              id: 'txn-split-other-payer',
              title: '晚餐',
              note: '朋友聚餐',
              account: null,
              split: {
                id: 'split-other-payer',
                type: 'EXPENSE',
                total: 300000,
                myShare: 75000,
                payer: { counterpartyId: 'cp-ming', name: '小明' },
                counterparts: [],
              },
            },
            {
              ...transactions[4],
              id: 'txn-split-me',
              title: '露營',
              split: {
                id: 'split-me',
                type: 'EXPENSE',
                total: 300000,
                myShare: 75000,
                payer: null,
                counterparts: [],
              },
            },
          ],
          page: 1,
          limit: 5,
          total: 5,
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

    // 首頁與交易頁共用名稱、分帳膠囊與金額列，備註和帳戶不出現在列上。
    expect(within(rows[0] as HTMLElement).getByText('-$100')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('餐飲')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText('第 1 筆')).not.toBeInTheDocument();
    expect(rows[0]).not.toHaveTextContent('現金');

    expect(within(rows[1] as HTMLElement).getByText('+$5,000')).toBeInTheDocument();

    const transferRow = rows[2] as HTMLElement;
    expect(within(transferRow).getByText('$500')).toBeInTheDocument();
    expect(within(transferRow).getByText('轉帳')).toBeInTheDocument();
    expect(transferRow).not.toHaveTextContent('現金');
    expect(transferRow).not.toHaveTextContent('國泰世華');

    // 分帳列只加膠囊與「›」展開入口，不在名稱旁放付款人或備註。
    const otherPayerRow = rows[3] as HTMLElement;
    expect(within(otherPayerRow).getByText('晚餐')).toBeInTheDocument();
    expect(within(otherPayerRow).getByText('分帳')).toBeInTheDocument();
    expect(within(otherPayerRow).getByRole('button', { name: '展開分帳明細' })).toBeInTheDocument();
    expect(within(otherPayerRow).getByText('-$750')).toBeInTheDocument();
    expect(otherPayerRow).not.toHaveTextContent('現金');
    expect(otherPayerRow).not.toHaveTextContent('朋友聚餐');

    const mePayerRow = rows[4] as HTMLElement;
    expect(within(mePayerRow).getByText('露營')).toBeInTheDocument();
    expect(within(mePayerRow).getByText('-$3,000')).toBeInTheDocument();
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
