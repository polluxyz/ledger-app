import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary } from '@ledger/shared';
import App from '../../App';
import { TransactionForm } from './TransactionForm';

/**
 * 新增交易表單上方的「支出／收入／轉帳／借還」分段控制（spec 2i SC-43.2、3b-1 W2）。
 *
 * 第三輪把選中的底色從按鈕身上抽出來，改成一個會滑動的方塊。**滑動本身在 jsdom
 * 看不到**（沒有版面，量不到 transform 的實際位置），所以這一檔驗的是改寫之後
 * 沒有弄丟的東西：按鈕的無障礙名稱、`aria-pressed` 跟著選擇變、方塊是裝飾
 * （`aria-hidden`）而且格數與按鈕數一致。
 *
 * 3b-1 加了第 4 格「借還」：新增模式固定多一格，方塊的寬度與位移照實際格數
 * 算（下面兩條釘住這件事）；編輯模式沒有那一格（借還交易不能編輯）。
 *
 * 策略：從真實的 `App` 出發，只把 `fetch` 換成 mock。表單住在右側欄，要先按
 * 「＋ 新增交易」才會出現，而且是 portal 進外殼的，所以一律用 `findBy*`。
 */
describe('Transaction type segmented control', () => {
  const fetchMock = vi.fn();

  /** 連動帳本才畫得出轉帳鈕（見 TransactionForm 的 `canTransfer`）。 */
  const trackingLedger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const plainLedger = { ...trackingLedger, id: 'ledger-2', tracksBalance: false };
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const accounts = [
    { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 },
    { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 5000 },
  ];

  function routeFetch(ledger: typeof trackingLedger, options: { items?: unknown[] } = {}) {
    const items = options.items ?? [];
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/debts/summary')) {
        return json({ items: [] });
      }
      if (url.includes('/debts')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/counterparties')) {
        return json({
          items: [
            {
              id: 'cp-1',
              name: '小明',
              balance: 15,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 100,
          total: 1,
        });
      }
      if (url.includes('/transactions')) {
        return json({ items, page: 1, limit: 20, total: items.length });
      }
      if (url.includes('/categories')) {
        return json([category]);
      }
      if (url.includes('/accounts')) {
        return json(accounts);
      }
      return json([ledger]);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  /** 按「新增交易」打開右側欄，回傳包住三顆型別鈕的那一條分段控制。 */
  async function openTypeBar(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '新增交易' }, WAIT));
    const expense = await screen.findByRole('button', { name: '支出' }, WAIT);
    const bar = expense.parentElement;
    expect(bar).not.toBeNull();
    return bar as HTMLElement;
  }

  it('marks the pressed type and moves the mark when another type is picked', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 預設是支出。名稱與 aria-pressed 都不能因為改寫而變。
    expect(within(bar).getByRole('button', { name: '支出' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(bar).getByRole('button', { name: '收入' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(within(bar).getByRole('button', { name: '收入' }));

    // 同一時間只有一顆是按下的——三顆各自畫底色的年代這件事靠 variant，
    // 現在靠 aria-pressed 與那個滑動的方塊，狀態本身必須一模一樣。
    expect(within(bar).getByRole('button', { name: '收入' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(bar).getByRole('button', { name: '支出' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(bar).getByRole('button', { name: '轉帳' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sizes the sliding mark by the number of buttons actually drawn', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 方塊是裝飾，螢幕閱讀器不該讀到它，也不該被當成第五顆按鈕。
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).not.toBeNull();
    // 四格（支出／收入／轉帳／借還）：一格是 1/4 寬，停在第一格（支出）。
    expect(within(bar).getAllByRole('button')).toHaveLength(4);
    expect(mark).toHaveStyle({ width: `${100 / 4}%`, transform: 'translateX(0%)' });

    await user.click(within(bar).getByRole('button', { name: '轉帳' }));

    // 第三格＝往右兩格。位置用 transform 而不是 left，切換時才滑得動。
    expect(mark).toHaveStyle({ transform: 'translateX(200%)' });
  });

  it('falls back to two slots when the ledger has no transfers', async () => {
    // 非連動帳本沒有轉帳鈕，方塊的寬度要跟著格數變（支出／收入／借還＝三格），
    // 否則會蓋到隔壁。
    routeFetch(plainLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    expect(within(bar).queryByRole('button', { name: '轉帳' })).not.toBeInTheDocument();
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).toHaveStyle({ width: `${100 / 3}%` });

    await user.click(within(bar).getByRole('button', { name: '收入' }));

    expect(mark).toHaveStyle({ transform: 'translateX(100%)' });
  });

  it('swaps the transaction fields for the debt entry form when 借還 is picked', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 第 4 格存在，預設沒選（spec 3b-1 W2）。
    const debtTab = within(bar).getByRole('button', { name: '借還' });
    expect(debtTab).toHaveAttribute('aria-pressed', 'false');

    await user.click(debtTab);

    expect(debtTab).toHaveAttribute('aria-pressed', 'true');
    // 借還分頁只有三種往來選項，交易欄位整個換掉。
    expect(await screen.findByRole('button', { name: '借出' }, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '借入' })).toBeInTheDocument();
    const debtKinds = screen.getByRole('group', { name: '往來種類' });
    expect(
      within(debtKinds)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['借出', '借入', '還款']);
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();
    expect(screen.getByLabelText('對象')).toBeInTheDocument();
    expect(screen.queryByLabelText('分類')).not.toBeInTheDocument();
  });

  it('opens on 借還 and pre-fills the counterparty when an initial name is provided', () => {
    routeFetch(trackingLedger);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} initialDebtCounterparty="小明" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('對象')).toHaveValue('小明');
  });

  it('does not offer the 借還 tab in the edit dialog', async () => {
    // 借還交易不能進編輯表單（后端 409 DEBT_TRANSACTION_READ_ONLY），編輯模式的
    // 分段控制不出現那一格。
    const expense = {
      id: 'txn-1',
      type: 'EXPENSE',
      amount: 120,
      date: '2026-08-12T04:00:00.000Z',
      note: '午餐',
      category,
      account: { id: 'acc-1', name: '現金' },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      createdAt: '2026-08-12T04:00:00.000Z',
    };
    routeFetch(trackingLedger, { items: [expense] });
    window.history.pushState({}, '', '/transactions');
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^編輯/ }, WAIT));

    const dialog = await screen.findByRole('dialog', {}, WAIT);
    expect(within(dialog).queryByRole('button', { name: '借還' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '支出' })).toBeInTheDocument();
  });
});
