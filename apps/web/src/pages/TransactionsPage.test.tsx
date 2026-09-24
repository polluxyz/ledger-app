import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 交易頁（spec 2i SC-34.2）：2h 首頁的交易表格整組搬過來。
 *
 * 這一檔只驗「搬過來之後這一頁該有什麼」——頁首、篩選列、列表、分頁、刪除確認，
 * 以及整列可點會在右側欄開啟編輯。篩選與分頁各自的行為仍由
 * `features/transactions/transaction-filters.test.tsx` 負責，這裡不重複。
 *
 * 借還檢視（spec 4.2）這裡只驗頁面層的兩件事：`?view=debts` 進來直接顯示借還檢視、
 * 點「明細」回到交易列表。淨額卡片、狀態分頁與列表本身的行為在
 * `features/debts/` 各自的測試檔裡。
 *
 * 橫條的帳本切換器一律用 `within(<main>)` 限定範圍：側欄那一份由另一位 worker
 * 移除，兩邊都在的那段期間整頁會有兩個「作用中帳本」。橫條在 `<main>` 之內，
 * 所以這個範圍同時涵蓋橫條與內容。
 */
describe('Transactions page', () => {
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
  const counterparty = {
    id: 'counterparty-1',
    name: '小明',
    balance: 5000,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };
  const debtEntry = {
    id: 'entry-1',
    counterpartyId: 'counterparty-1',
    kind: 'LEND',
    delta: 5000,
    date: '2026-09-01T04:00:00.000Z',
    note: null,
    transactionId: 'txn-debt',
    balanceAfter: 5000,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };
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
    debt: null,
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
        // `total` 刻意大於 `limit`：只有不只一頁時分頁列才會出現。
        return json({ items: [lunch], page: 1, limit: 20, total: 42 });
      }
      if (url.includes('/categories')) {
        return json([expenseCategory]);
      }
      if (url.includes('/accounts')) {
        return json([account]);
      }
      if (url.includes('/counterparties/counterparty-1/entries')) {
        return json({ items: [debtEntry], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/counterparties/counterparty-1')) {
        return json(counterparty);
      }
      if (url.includes('/counterparties')) {
        return json({ items: [counterparty], page: 1, limit: 20, total: 1 });
      }
      return json([ledger]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  /** 橫條與內容都在 `<main>` 裡，側欄不在。 */
  const page = () => within(screen.getByRole('main'));

  /**
   * 「在橫條裡」的判準，刻意不看 CSS 類名：橫條在中間區的最上方、頁面標題列之外，
   * 所以它裡面的東西一定不在 `<header>` 裡，而且在 DOM 順序上排在標題之前。
   */
  function expectInToolbar(element: HTMLElement, heading: HTMLElement) {
    expect(element.closest('header')).toBeNull();
    expect(element.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }

  it('lists the ledger transactions with the filters and the pager', async () => {
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    expect(within(item).getByText('餐飲')).toBeInTheDocument();
    // 金額直接以元顯示，不做任何換算。
    expect(within(item).getByText('-$120')).toBeInTheDocument();

    expect(screen.getByRole('region', { name: '篩選交易' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '分頁' })).toBeInTheDocument();
  });

  it('puts the ledger switcher and the add button in the page toolbar', async () => {
    render(<App />);

    // 標題在帳本載入前就有了，所以等的是只有載完才出現的「＋ 新增交易」。
    const addButton = await page().findByRole('button', { name: '新增交易' }, WAIT);
    const heading = screen.getByRole('heading', { name: '交易' });

    // 兩者都在橫條裡（SC-38.2、SC-38.3）。
    expectInToolbar(addButton, heading);
    // 只有一本帳本，切換器是純文字而不是下拉（SC-33.2）。
    expectInToolbar(page().getByText('我的帳本'), heading);
    expect(page().queryByLabelText('作用中帳本')).not.toBeInTheDocument();

    // SC-38.5：標題上方不再有任何一行字。
    expect(heading.closest('header')?.firstElementChild).toBe(heading);
  });

  it('opens the editor in the right panel when a row is clicked', async () => {
    // 整列可點就是編輯（2h · D17），面板在右側欄，不蓋住列表。
    const user = userEvent.setup();
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    await user.click(within(item).getByText('午餐'));

    const panel = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(panel).getByLabelText('金額')).toHaveValue(120);
  });

  it('asks before deleting and says that it cannot be undone', async () => {
    // 後端是軟刪除，但畫面上沒有還原的路——文案要照實說。
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /^刪除/ }, WAIT));

    const confirm = await screen.findByRole('dialog', { name: '刪除交易' }, WAIT);
    expect(within(confirm).getByText(/刪除後無法復原/)).toBeInTheDocument();
  });

  it('says there is no ledger instead of showing an empty table', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('找不到任何帳本。', undefined, WAIT)).toBeInTheDocument();
    // 沒有帳本就沒有地方可以記帳，右側欄不該登記，新增表單也不該出現。
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });

  it('shows the debts view directly when the URL has ?view=debts', async () => {
    // 檢視在網址上（SC-W9）：重整後停在同一個檢視，這裡直接帶著參數進來。
    window.history.pushState({}, '', '/transactions?view=debts');
    render(<App />);

    expect(await screen.findByText('借還紀錄不分帳本', undefined, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('欠我 $5,000', undefined, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /小明/ }, WAIT)).toBeInTheDocument();
    expect(page().getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');

    // 明細那套（篩選列與交易列表）不該同時出現。
    expect(screen.queryByRole('region', { name: '篩選交易' })).not.toBeInTheDocument();
    expect(screen.queryByText('午餐')).not.toBeInTheDocument();
  });

  it('returns to the transaction list when 明細 is clicked', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions?view=debts');
    render(<App />);

    await screen.findByRole('button', { name: /小明/ }, WAIT);

    await user.click(page().getByRole('button', { name: '明細' }));

    // 回到明細：交易列表回來了，借還那套不再出現。
    const item = await screen.findByRole('listitem', undefined, WAIT);
    expect(within(item).getByText('午餐')).toBeInTheDocument();
    expect(screen.queryByText('借還紀錄不分帳本')).not.toBeInTheDocument();
    // 網址上的參數被清掉——再重整一次還是明細。
    expect(window.location.search).toBe('');
  });

  it('opens debt detail in right panel when clicking a debt item in debts view', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions?view=debts');
    render(<App />);

    const debtButton = await screen.findByRole('button', { name: /小明/ }, WAIT);
    await user.click(debtButton);

    const dialog = await screen.findByRole('dialog', { name: '借還往來' }, WAIT);
    expect(within(dialog).getByText('小明欠你 $5,000')).toBeInTheDocument();
    expect(within(dialog).getByText('往來紀錄')).toBeInTheDocument();
  });

  it('starts a prefilled debt entry when 記一筆 is selected in the counterparty panel', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions?view=debts');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /小明/ }, WAIT));
    const detail = await screen.findByRole('dialog', { name: '借還往來' }, WAIT);
    await user.click(within(detail).getByRole('button', { name: '記一筆' }));

    const form = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    expect(within(form).getByRole('button', { name: '借還' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByLabelText('對象')).toHaveValue('小明');
  });

  it('opens debt detail in right panel when clicking a debt transaction in details view', async () => {
    const lendTxn = {
      id: 'txn-lend',
      type: 'LEND',
      amount: 5000,
      date: '2026-09-01T04:00:00.000Z',
      note: '借出款項',
      category: null,
      account: { id: account.id, name: account.name },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      debt: {
        entryId: 'entry-1',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
      },
      createdAt: '2026-09-01T04:00:00.000Z',
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
        return json({ items: [lendTxn], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/categories')) {
        return json([expenseCategory]);
      }
      if (url.includes('/accounts')) {
        return json([account]);
      }
      if (url.includes('/counterparties/counterparty-1/entries')) {
        return json({ items: [debtEntry], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/counterparties/counterparty-1')) {
        return json(counterparty);
      }
      if (url.includes('/counterparties')) {
        return json({ items: [counterparty], page: 1, limit: 20, total: 1 });
      }
      return json([ledger]);
    });

    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions');
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    await user.click(within(item).getByRole('button', { name: '查看小明的借還' }));

    const dialog = await screen.findByRole('dialog', { name: '借還往來' }, WAIT);
    expect(within(dialog).getByText('小明欠你 $5,000')).toBeInTheDocument();
  });

  it('keeps an open add panel open while switching between details and debts', async () => {
    const user = userEvent.setup();
    render(<App />);

    const addButton = await page().findByRole('button', { name: '新增交易' }, WAIT);
    await user.click(addButton);
    const addForm = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    const panel = addForm.closest('[data-open]');
    expect(panel).toHaveAttribute('data-open');

    await user.click(page().getByRole('button', { name: '借還' }));

    expect(panel).toHaveAttribute('data-open');
    expect(await screen.findByText('借還紀錄不分帳本', undefined, WAIT)).toBeInTheDocument();
  });
});
