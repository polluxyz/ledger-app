import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 新增交易表單上方的「支出／收入／轉帳」分段控制（spec 2i SC-43.2）。
 *
 * 第三輪把選中的底色從按鈕身上抽出來，改成一個會滑動的方塊。**滑動本身在 jsdom
 * 看不到**（沒有版面，量不到 transform 的實際位置），所以這一檔驗的是改寫之後
 * 沒有弄丟的東西：三顆鈕的無障礙名稱、`aria-pressed` 跟著選擇變、方塊是裝飾
 * （`aria-hidden`）而且格數與按鈕數一致。
 *
 * 策略：從真實的 `App` 出發，只把 `fetch` 換成 mock。表單住在右側欄，要先按
 * 「＋ 新增交易」才會出現，而且是 portal 進外殼的，所以一律用 `findBy*`。
 */
describe('Transaction type segmented control', () => {
  const fetchMock = vi.fn();

  /** 連動帳本才畫得出轉帳鈕（見 TransactionForm 的 `canTransfer`）。 */
  const trackingLedger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const plainLedger = { ...trackingLedger, id: 'ledger-2', tracksBalance: false };
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const accounts = [
    { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 },
    { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 5000 },
  ];

  function routeFetch(ledger: typeof trackingLedger) {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/transactions')) {
        return json({ items: [], page: 1, limit: 20, total: 0 });
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

    // 方塊是裝飾，螢幕閱讀器不該讀到它，也不該被當成第四顆按鈕。
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).not.toBeNull();
    expect(within(bar).getAllByRole('button')).toHaveLength(3);
    // 三格：一格是 1/3 寬，停在第一格（支出）。
    expect(mark).toHaveStyle({ width: `${100 / 3}%`, transform: 'translateX(0%)' });

    await user.click(within(bar).getByRole('button', { name: '轉帳' }));

    // 第三格＝往右兩格。位置用 transform 而不是 left，切換時才滑得動。
    expect(mark).toHaveStyle({ transform: 'translateX(200%)' });
  });

  it('falls back to two slots when the ledger has no transfers', async () => {
    // 非連動帳本沒有轉帳鈕，方塊的寬度要跟著變成一半，否則會蓋到隔壁。
    routeFetch(plainLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    expect(within(bar).queryByRole('button', { name: '轉帳' })).not.toBeInTheDocument();
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).toHaveStyle({ width: '50%' });

    await user.click(within(bar).getByRole('button', { name: '收入' }));

    expect(mark).toHaveStyle({ transform: 'translateX(100%)' });
  });
});
