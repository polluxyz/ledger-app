import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 交易頁（spec 2i SC-34.2）：2h 首頁的交易表格整組搬過來。
 *
 * 這一檔只驗「搬過來之後這一頁該有什麼」——頁首、收起的篩選、列表、分頁、編輯面板刪除，
 * 以及整列可點會在右側欄開啟編輯。篩選與分頁各自的行為仍由
 * `features/transactions/transaction-filters.test.tsx` 負責，這裡不重複。
 *
 * 借還檢視（spec 4.2）這裡只驗頁面層的兩件事：`?view=debts` 進來直接顯示借還檢視、
 * 點「明細」回到交易列表。淨額卡片、狀態分頁與列表本身的行為在
 * `features/debts/` 各自的測試檔裡。
 *
 * 帳本切換器一律用 `within(<main>)` 限定範圍，它住在「明細／借還」那一排（開發者
 * 2026-10-07），在 `<main>` 之內，這個範圍同時涵蓋那一排與內容。
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
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 88000 };
  const counterparty = {
    id: 'counterparty-1',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    link: null,
    balance: 500000,
    ledgerParts: [],
    totalBalance: 500000,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };
  const debtEntry = {
    id: 'entry-1',
    counterpartyId: 'counterparty-1',
    kind: 'LEND',
    delta: 500000,
    date: '2026-09-01T04:00:00.000Z',
    note: null,
    transactionId: 'txn-debt',
    balanceAfter: 500000,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
    paired: false,
  };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 12000,
    date: '2026-08-12T04:00:00.000Z',
    title: '午餐',
    note: null,
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'u1', name: 'Alice' },
    debt: null,
    createdAt: '2026-08-12T04:00:00.000Z',
  };

  let transactionDeleted = false;

  beforeEach(() => {
    transactionDeleted = false;
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/transactions');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions') && init?.method === 'DELETE') {
        transactionDeleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/transactions')) {
        // `total` 刻意大於 `limit`：只有不只一頁時分頁列才會出現。
        return json({ items: transactionDeleted ? [] : [lunch], page: 1, limit: 20, total: 42 });
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
      if (url.includes('/ledger-groups')) {
        return json([]);
      }
      return json([ledger]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  function parseRequestBody(options: RequestInit): unknown {
    if (typeof options.body !== 'string') {
      throw new Error('往來修改請求缺少 JSON body');
    }
    return JSON.parse(options.body) as unknown;
  }

  /** 分頁那一排與內容都在 `<main>` 裡，側欄不在。 */
  const page = () => within(screen.getByRole('main'));

  it('lists the ledger transactions with the filters and the pager', async () => {
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    expect(within(item).getByText('午餐')).toBeInTheDocument();
    // API 回傳分，畫面仍顯示原本的人看單位。
    expect(within(item).getByText('-$120')).toBeInTheDocument();

    const filterToggle = screen.getByRole('button', { name: '篩選' });
    expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '篩選交易' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '分頁' })).toBeInTheDocument();
  });

  it('puts the ledger switcher and the add button on the view-switch row', async () => {
    render(<App />);

    // 標題在帳本載入前就有了，所以等的是只有載完才出現的「＋ 新增交易」。
    const addButton = await page().findByRole('button', { name: '新增交易' }, WAIT);
    const viewSwitch = page().getByRole('group', { name: '檢視' });

    /*
     * 開發者 2026-10-07：最上排橫條清空留給 AI 功能，帳本切換、「＋ 新增交易」
     * 移進「明細／借還」那一排。判準刻意不看 CSS 類名：「同一排的右邊」就是在
     * 檢視切換之後（DOM 順序）。
     */
    expect(
      viewSwitch.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    // 只有一本帳本，切換器是純文字而不是下拉（SC-33.2）。
    const switcher = page().getByText('我的帳本');
    expect(
      viewSwitch.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(page().queryByLabelText('作用中帳本')).not.toBeInTheDocument();

    // 標題仍是頁首裡的第一個東西——每一頁的標題高度才會一致。
    const heading = screen.getByRole('heading', { name: '交易' });
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

  it('deletes from the editor, confirms, refreshes the list, and closes the panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    expect(within(item).queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();
    await user.click(within(item).getByText('午餐'));
    const editor = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    await user.click(within(editor).getByRole('button', { name: '刪除' }));

    const confirm = await screen.findByRole('dialog', { name: '刪除交易' }, WAIT);
    expect(within(confirm).getByText(/刪除後無法復原/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: '刪除' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '刪除交易' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open'),
    );
    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
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

    expect(await screen.findByRole('group', { name: '借還' }, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('小明欠你 $5,000', undefined, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /小明/ }, WAIT)).toBeInTheDocument();
    expect(page().getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');

    // 明細那套（篩選列與交易列表）不該同時出現。
    expect(screen.queryByRole('button', { name: '篩選' })).not.toBeInTheDocument();
    expect(screen.queryByText('午餐')).not.toBeInTheDocument();

    // 借還不分帳本：帳本切換與「＋ 新增交易」不跟進這個檢視（它們只屬於明細）。
    expect(screen.queryByRole('button', { name: '新增交易' })).not.toBeInTheDocument();
    expect(screen.queryByText('我的帳本')).not.toBeInTheDocument();
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

  it('switches to debts and expands a requested counterparty from another page', async () => {
    // 其他頁用 location.state 指定對象；交易頁消耗指示後只切檢視並展開清單列。
    window.history.pushState(
      { usr: { openCounterpartyId: 'counterparty-1' }, key: 'from-home', idx: 0 },
      '',
      '/transactions?view=debts',
    );
    render(<App />);

    const row = await screen.findByRole('button', { name: /小明/ }, WAIT);
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'), WAIT);
    expect(await screen.findByText('借出', undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '借還往來' })).not.toBeInTheDocument();
    await waitFor(() => {
      const state = window.history.state as { usr?: Record<string, unknown> };
      expect(state.usr ?? {}).not.toHaveProperty('openCounterpartyId');
    }, WAIT);
    expect(window.location.search).toBe('?view=debts&tab=overview');
  });

  it('opens the debt form in the personal tab without opening the right panel', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions?view=debts&tab=personal');
    render(<App />);

    const debtButton = await screen.findByRole('button', { name: /小明/ }, WAIT);
    await user.click(debtButton);

    expect(debtButton).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: '記一筆' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '借還往來' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '記一筆' }));
    expect(await screen.findByLabelText('對象', undefined, WAIT)).toHaveValue('小明');
    expect(screen.queryByRole('dialog', { name: '借還往來' })).not.toBeInTheDocument();
  });

  it('edits a linked debt transaction directly and closes after sending only the changed amount', async () => {
    let updatedAmount = 500000;
    const lendTxn = {
      id: 'txn-lend',
      type: 'LEND',
      amount: 500000,
      date: '2026-09-01T04:00:00.000Z',
      note: null,
      category: null,
      account: { id: account.id, name: account.name },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      debt: {
        entryId: 'entry-1',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
        paired: false,
        note: '借出款項',
      },
      createdAt: '2026-09-01T04:00:00.000Z',
    };
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/debt-entries/entry-1') && options?.method === 'PATCH') {
        if (typeof options.body !== 'string') {
          throw new Error('往來修改請求缺少 JSON body');
        }
        const input = JSON.parse(options.body) as { amount?: unknown };
        if (typeof input.amount !== 'number') {
          throw new Error('往來修改請求沒有數字金額');
        }
        updatedAmount = input.amount;
        return json({ ...debtEntry, delta: updatedAmount });
      }
      if (url.includes('/transactions')) {
        return json({
          items: [{ ...lendTxn, amount: updatedAmount }],
          page: 1,
          limit: 20,
          total: 1,
        });
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
      if (url.includes('/ledger-groups')) {
        return json([]);
      }
      return json([ledger]);
    });

    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions');
    render(<App />);

    const item = await screen.findByRole('listitem', undefined, WAIT);
    await user.click(within(item).getByRole('button', { name: /^編輯/ }));

    const dialog = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(dialog).getByText('借出 · 小明')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('金額')).toHaveValue(5000);
    expect(within(dialog).getByLabelText('日期')).toHaveValue('2026-09-01');
    expect(within(dialog).getByLabelText('備註')).toHaveValue('借出款項');
    expect(within(dialog).queryByText('會送給小明確認')).not.toBeInTheDocument();

    const rightPanel = dialog.closest('[data-registered]');
    await user.clear(within(dialog).getByLabelText('金額'));
    await user.type(within(dialog).getByLabelText('金額'), '6000');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, request]) =>
            String(url).includes('/debt-entries/entry-1') &&
            (request as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true);
    }, WAIT);
    const patchCall = fetchMock.mock.calls.find(
      ([url, request]) =>
        String(url).includes('/debt-entries/entry-1') &&
        (request as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    expect(parseRequestBody(patchCall?.[1] as RequestInit)).toEqual({ amount: 600000 });

    await waitFor(() => expect(rightPanel).not.toHaveAttribute('data-open'), WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57）：它在 inert 裡，而且沒有換成新增表單。
    expect(screen.getByRole('dialog', { name: '編輯交易' }).closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
    expect(await screen.findByText('-$6,000', undefined, WAIT)).toBeInTheDocument();
  });

  /*
   * 借還交易本身的 note 一律是 null，備註存在往來紀錄上（debt.note）。面板要帶入的是後者，
   * 否則使用者看到空白、填了字就會蓋掉原本的備註。
   */
  it('shows the paired line and prefills the note from the debt entry, not the transaction', async () => {
    const lendTxn = {
      id: 'txn-lend',
      type: 'LEND',
      amount: 500000,
      date: '2026-09-01T04:00:00.000Z',
      note: null,
      category: null,
      account: { id: account.id, name: account.name },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      debt: {
        entryId: 'entry-1',
        counterpartyId: 'counterparty-1',
        counterpartyName: '小明',
        paired: true,
        note: '晚餐錢',
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
      return json([ledger]);
    });

    const user = userEvent.setup();
    render(<App />);
    const item = await screen.findByRole('listitem', undefined, WAIT);
    await user.click(within(item).getByRole('button', { name: /^編輯/ }));

    const dialog = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(dialog).getByText('會送給小明確認')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('備註')).toHaveValue('晚餐錢');
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
    expect(await screen.findByRole('group', { name: '借還' }, WAIT)).toBeInTheDocument();
  });

  it('has two main tabs, defaults to overview, and writes debt subtabs to the URL', async () => {
    const user = userEvent.setup();
    render(<App />);

    const mainTabs = await page().findByRole('group', { name: '檢視' }, WAIT);
    expect(within(mainTabs).getAllByRole('button')).toHaveLength(2);
    expect(within(mainTabs).queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
    await user.click(within(mainTabs).getByRole('button', { name: '借還' }));

    const debtsTabs = await page().findByRole('group', { name: '借還' }, WAIT);
    expect(within(debtsTabs).getByRole('button', { name: '總覽' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.location.search).toBe('?view=debts&tab=overview');

    await user.click(within(debtsTabs).getByRole('button', { name: '個人' }));
    expect(window.location.search).toBe('?view=debts&tab=personal');
    expect(page().queryByRole('button', { name: '＋ 新增' })).not.toBeInTheDocument();

    await user.click(within(debtsTabs).getByRole('button', { name: '共享' }));
    expect(window.location.search).toBe('?view=debts&tab=shared');
    expect(await screen.findByText('目前沒有共享帳本。', undefined, WAIT)).toBeInTheDocument();

    await user.click(within(debtsTabs).getByRole('button', { name: '歷史' }));
    expect(window.location.search).toBe('?view=debts&tab=history');
  });

  it('shows every shared ledger, expands its settlement form inline on transfer row click', async () => {
    const sharedLedger = {
      ...ledger,
      id: 'ledger-2',
      name: '旅行帳本',
      kind: 'SHARED',
      role: 'EDITOR',
      tracksBalance: false,
    };
    const archivedLedger = {
      ...sharedLedger,
      id: 'ledger-archived',
      name: '封存帳本',
      archivedAt: '2026-09-01T00:00:00.000Z',
    };
    const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
    const min = { id: 'person-min', name: '小明', userId: 'user-2', status: 'MEMBER' };
    const settlementHistory = {
      ...lunch,
      id: 'settlement-tx',
      type: 'TRANSFER',
      amount: 205000,
      title: null,
      settlement: { id: 'settlement-1', from: min, to: me },
    };
    const ordinaryTransfer = {
      ...settlementHistory,
      id: 'ordinary-transfer',
      settlement: null,
      title: '普通轉帳',
    };
    let createCalled = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/users/me')) return json({ id: 'user-1', name: 'Alice' });
      if (url.endsWith('/ledgers/ledger-2/people')) return json([me, min]);
      if (url.endsWith('/ledgers/ledger-archived/people')) return json([me, min]);
      if (url.endsWith('/ledgers/ledger-2/settlement-summary')) {
        return json({
          people: [
            { person: me, net: 205000 },
            { person: min, net: -205000 },
          ],
          suggestions: [{ fromPersonId: min.id, toPersonId: me.id, amount: 205000 }],
        });
      }
      if (url.endsWith('/ledgers/ledger-archived/settlement-summary')) {
        return json({ people: [], suggestions: [] });
      }
      if (url.endsWith('/ledgers/ledger-2/settlements') && init?.method === 'POST') {
        createCalled = true;
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/transactions')) {
        return json({
          items: [settlementHistory, ordinaryTransfer],
          page: 1,
          limit: 100,
          total: 2,
        });
      }
      if (url.includes('/categories')) return json([expenseCategory]);
      if (url.includes('/accounts')) return json([account]);
      if (url.includes('/ledger-groups')) return json([]);
      if (url.includes('/ledgers?includeArchived=true'))
        return json([sharedLedger, archivedLedger]);
      if (url.endsWith('/ledgers')) return json([ledger]);
      return json([sharedLedger]);
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(await page().findByRole('button', { name: '借還' }, WAIT));
    await user.click(await page().findByRole('button', { name: '共享' }, WAIT));
    const group = await screen.findByRole('region', { name: '旅行帳本' }, WAIT);
    const archivedGroup = screen.getByRole('region', { name: '封存帳本' });
    expect(within(group).queryByRole('heading', { name: '淨額' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: '新增結清' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: '歷史' })).not.toBeInTheDocument();
    expect(
      within(archivedGroup).queryByRole('button', { name: '新增結清' }),
    ).not.toBeInTheDocument();

    const transferRow = within(group).getByRole('button', { name: '小明欠我 $2,050' });
    await user.click(transferRow);
    const form = within(group).getByLabelText('付錢的人').closest('form');
    expect(form).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: '結清' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(form as HTMLFormElement).getByLabelText('付錢的人')).toHaveValue(min.id);
      expect(within(form as HTMLFormElement).getByLabelText('收錢的人')).toHaveValue(me.id);
      expect(within(form as HTMLFormElement).getByLabelText('金額')).toHaveValue(2050);
    }, WAIT);
    await user.click(within(form as HTMLFormElement).getByRole('button', { name: '新增' }));
    await waitFor(() => expect(createCalled).toBe(true), WAIT);
    await waitFor(
      () => expect(within(group).queryByLabelText('金額')).not.toBeInTheDocument(),
      WAIT,
    );
  });

  it('opens an old settle URL in shared and prefills without changing the active ledger', async () => {
    const sharedLedger = {
      ...ledger,
      id: 'ledger-2',
      name: '旅行帳本',
      kind: 'SHARED',
      role: 'EDITOR',
      tracksBalance: false,
    };
    const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
    const other = { id: 'person-other', name: '小明', userId: 'user-2', status: 'MEMBER' };
    window.history.pushState(
      {
        usr: { settleIntent: { ledgerId: sharedLedger.id, personId: other.id, amount: -51200 } },
        key: 'from-debts',
        idx: 0,
      },
      '',
      '/transactions?view=settle',
    );
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/users/me')) return json({ id: 'user-1', name: 'Alice' });
      if (url.endsWith('/ledgers/ledger-2/people')) return json([me, other]);
      if (url.endsWith('/ledgers/ledger-2/settlement-summary'))
        return json({
          people: [me, other],
          suggestions: [{ fromPersonId: me.id, toPersonId: other.id, amount: 51200 }],
        });
      if (url.includes('/transactions'))
        return json({ items: [lunch], page: 1, limit: 20, total: 1 });
      if (url.endsWith('/accounts')) return json([account]);
      if (url.endsWith('/categories')) return json([expenseCategory]);
      if (url.endsWith('/ledgers?includeArchived=true')) return json([ledger, sharedLedger]);
      if (url.endsWith('/ledgers')) return json([ledger]);
      return json([ledger]);
    });

    render(<App />);

    const group = await screen.findByRole('region', { name: '旅行帳本' }, WAIT);
    await waitFor(() => {
      expect(within(group).getByLabelText('付錢的人')).toHaveValue(me.id);
      expect(within(group).getByLabelText('收錢的人')).toHaveValue(other.id);
      expect(within(group).getByLabelText('金額')).toHaveValue(512);
    }, WAIT);
    await waitFor(() => {
      expect(window.location.search).toBe('?view=debts&tab=shared');
      expect(localStorage.getItem('ledger.activeLedgerId')).toBe(ledger.id);
      expect((window.history.state as { usr?: Record<string, unknown> }).usr).toBeNull();
    }, WAIT);
  });

  it('keeps shared summary visible for viewers while hiding write buttons', async () => {
    const viewerLedger = { ...ledger, kind: 'SHARED', role: 'VIEWER', tracksBalance: false };
    const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
    const min = { id: 'person-min', name: '小明', userId: 'user-2', status: 'MEMBER' };
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/users/me')) return json({ id: 'user-1', name: 'Alice' });
      if (url.endsWith('/ledgers/ledger-1/settlement-summary')) {
        return json({
          people: [
            { person: me, net: 1000 },
            { person: min, net: -1000 },
          ],
          suggestions: [{ fromPersonId: min.id, toPersonId: me.id, amount: 1000 }],
        });
      }
      if (url.includes('/transactions')) {
        return json({ items: [lunch], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/categories')) return json([expenseCategory]);
      if (url.includes('/accounts')) return json([account]);
      if (url.includes('/ledgers?includeArchived=true')) return json([viewerLedger]);
      if (url.endsWith('/ledgers')) return json([viewerLedger]);
      return json([viewerLedger]);
    });
    window.history.pushState({}, '', '/transactions?view=debts&tab=shared');
    render(<App />);

    expect(await screen.findByText('小明欠我 $10', undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '淨額' })).not.toBeInTheDocument();
    expect(page().queryByRole('button', { name: '新增結清' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '小明欠我 $10' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
  });
});
