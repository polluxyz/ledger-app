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
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 88000 };
  const counterparty = {
    id: 'counterparty-1',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    link: null,
    balance: 500000,
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
    expect(within(item).getByText('午餐')).toBeInTheDocument();
    // API 回傳分，畫面仍顯示原本的人看單位。
    expect(within(item).getByText('-$120')).toBeInTheDocument();

    const filterToggle = screen.getByRole('button', { name: '篩選' });
    expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '篩選交易' })).not.toBeInTheDocument();
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

    expect(await screen.findByText('借還紀錄不分帳本', undefined, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('小明欠你 $5,000', undefined, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /小明/ }, WAIT)).toBeInTheDocument();
    expect(page().getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');

    // 明細那套（篩選列與交易列表）不該同時出現。
    expect(screen.queryByRole('button', { name: '篩選' })).not.toBeInTheDocument();
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

  it('opens the counterparty ledger requested by another page, only once', async () => {
    // 總覽或邀請頁用 location.state 指定要打開誰（phase-3b2-web W41）。BrowserRouter 把
    // state 放在 history.state.usr，這裡直接模擬「從別頁導過來」的那一筆 history。
    window.history.pushState(
      { usr: { openCounterpartyId: 'counterparty-1' }, key: 'from-home', idx: 0 },
      '',
      '/transactions?view=debts',
    );
    render(<App />);

    const dialog = await screen.findByRole('dialog', { name: '借還往來' }, WAIT);
    expect(within(dialog).getByText('小明欠你 $5,000')).toBeInTheDocument();
    // 指示用過就換掉：重新整理不會再打開一次，網址維持在借還檢視。
    await waitFor(() => {
      const state = window.history.state as { usr?: Record<string, unknown> };
      expect(state.usr).toEqual({ keepRightPanel: true });
    });
    expect(window.location.search).toBe('?view=debts');
    expect(screen.getByRole('dialog', { name: '借還往來' })).toBeInTheDocument();
  });

  it('closes the right panel without showing the add form after closing debt detail', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/transactions?view=debts');
    render(<App />);

    const debtButton = await screen.findByRole('button', { name: /小明/ }, WAIT);
    await user.click(debtButton);

    const dialog = await screen.findByRole('dialog', { name: '借還往來' }, WAIT);
    expect(within(dialog).getByText('小明欠你 $5,000')).toBeInTheDocument();
    expect(within(dialog).getByText('往來紀錄')).toBeInTheDocument();

    const rightPanel = dialog.closest('[data-registered]');
    await user.click(within(dialog).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(rightPanel).not.toHaveAttribute('data-open'), WAIT);
    // 收起時內容留著讓滑出動畫顯示同一個面板（W57）：它在 inert 裡，而且沒有換成新增表單。
    expect(screen.getByRole('dialog', { name: '借還往來' }).closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
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
    expect(await screen.findByText('借還紀錄不分帳本', undefined, WAIT)).toBeInTheDocument();
  });

  it('shows the settle view only for a shared ledger and opens a suggested settlement', async () => {
    const sharedLedger = { ...ledger, kind: 'SHARED', role: 'EDITOR' };
    const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
    const min = { id: 'person-min', name: '小明', userId: 'user-2', status: 'MEMBER' };
    const sharedPeople = [me, min];
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/users/me')) return json({ id: 'user-1', name: 'Alice' });
      if (url.endsWith('/ledgers/ledger-1/people')) return json(sharedPeople);
      if (url.endsWith('/ledgers/ledger-1/settlement-summary')) {
        return json({
          people: [
            { person: me, net: 205000 },
            { person: min, net: -205000 },
          ],
          suggestions: [{ fromPersonId: min.id, toPersonId: me.id, amount: 205000 }],
        });
      }
      if (url.includes('/transactions')) {
        return json({ items: [lunch], page: 1, limit: 20, total: 1 });
      }
      if (url.includes('/categories')) return json([expenseCategory]);
      if (url.includes('/accounts')) return json([account]);
      return json([sharedLedger]);
    });

    const user = userEvent.setup();
    render(<App />);

    const viewSwitch = await page().findByRole('group', { name: '檢視' }, WAIT);
    expect(within(viewSwitch).getAllByRole('button')).toHaveLength(3);
    await user.click(within(viewSwitch).getByRole('button', { name: '結清' }));

    expect(window.location.search).toBe('?view=settle');
    expect(await screen.findByRole('heading', { name: '淨額' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '篩選' })).not.toBeInTheDocument();
    expect(page().getByRole('button', { name: '新增結清' })).toBeInTheDocument();

    const suggestions = screen.getByRole('region', { name: '轉帳' });
    await user.click(within(suggestions).getByRole('button', { name: '結清' }));
    const form = await screen.findByRole('dialog', { name: '結清' }, WAIT);
    expect(within(form).getByLabelText('付錢的人')).toHaveValue(min.id);
    expect(within(form).getByLabelText('收錢的人')).toHaveValue(me.id);
    expect(within(form).getByLabelText('金額')).toHaveValue(2050);
  });

  it.each([
    { amount: 51200, fromPersonId: 'person-other', toPersonId: 'person-me' },
    { amount: -51200, fromPersonId: 'person-me', toPersonId: 'person-other' },
  ])(
    'receives a settlement intent, switches ledger and prefills the direction for $amount cents',
    async ({ amount, fromPersonId, toPersonId }) => {
      const sharedLedger = { ...ledger, id: 'ledger-2', name: '旅行帳本', kind: 'SHARED' };
      const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
      const other = { id: 'person-other', name: '小明', userId: 'user-2', status: 'MEMBER' };
      window.history.pushState(
        {
          usr: {
            settleIntent: { ledgerId: sharedLedger.id, personId: other.id, amount },
          },
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
        if (url.endsWith('/ledgers/ledger-2/settlement-summary')) {
          return json({
            people: [
              { person: me, net: 51200 },
              { person: other, net: -51200 },
            ],
            suggestions: [{ fromPersonId: other.id, toPersonId: me.id, amount: 51200 }],
          });
        }
        if (url.includes('/transactions')) {
          return json({ items: [lunch], page: 1, limit: 20, total: 1 });
        }
        if (url.endsWith('/accounts')) return json([account]);
        if (url.endsWith('/categories')) return json([expenseCategory]);
        if (url.endsWith('/ledgers')) return json([ledger, sharedLedger]);
        return json([ledger]);
      });

      render(<App />);

      const form = await screen.findByRole('dialog', { name: '結清' }, WAIT);
      expect(within(form).getByLabelText('付錢的人')).toHaveValue(fromPersonId);
      expect(within(form).getByLabelText('收錢的人')).toHaveValue(toPersonId);
      expect(within(form).getByLabelText('金額')).toHaveValue(512);
      expect(window.location.search).toBe('?view=settle');
      await waitFor(() => {
        expect(localStorage.getItem('ledger.activeLedgerId')).toBe(sharedLedger.id);
        expect((window.history.state as { usr?: Record<string, unknown> }).usr).toEqual({
          keepRightPanel: true,
        });
      });
      const switcher = page().getByRole('group', { name: '作用中帳本' });
      expect(within(switcher).getByRole('button')).toHaveTextContent('旅行帳本');
    },
  );

  it('ignores and clears a settlement intent when its ledger is not in my ledger list', async () => {
    window.history.pushState(
      {
        usr: {
          settleIntent: { ledgerId: 'not-mine', personId: 'person-other', amount: 51200 },
        },
        key: 'from-debts',
        idx: 0,
      },
      '',
      '/transactions?view=settle',
    );

    render(<App />);

    expect(await screen.findByText('午餐', undefined, WAIT)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.search).toBe('');
      expect((window.history.state as { usr?: Record<string, unknown> }).usr).toEqual({
        keepRightPanel: true,
      });
    });
    expect(screen.queryByRole('dialog', { name: '結清' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ledgers/not-mine/'))).toBe(
      false,
    );
  });

  it('returns a personal ledger from ?view=settle to the two-tab details view', async () => {
    window.history.pushState({}, '', '/transactions?view=settle');
    render(<App />);

    const viewSwitch = await page().findByRole('group', { name: '檢視' }, WAIT);
    expect(within(viewSwitch).getAllByRole('button')).toHaveLength(2);
    expect(await screen.findByText('午餐', undefined, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(''), WAIT);
    expect(screen.getByRole('button', { name: '篩選' })).toBeInTheDocument();
  });

  it('keeps the settle view for viewers while hiding settlement actions', async () => {
    const viewerLedger = { ...ledger, kind: 'SHARED', role: 'VIEWER' };
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
      return json([viewerLedger]);
    });
    window.history.pushState({}, '', '/transactions?view=settle');
    render(<App />);

    expect(await screen.findByRole('heading', { name: '淨額' }, WAIT)).toBeInTheDocument();
    expect(page().queryByRole('button', { name: '新增結清' })).not.toBeInTheDocument();
    const suggestions = screen.getByRole('region', { name: '轉帳' });
    expect(within(suggestions).queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
  });
});
