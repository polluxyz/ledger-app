import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt } from '@ledger/shared';
import { DebtsView } from './DebtsView';

/**
 * 借還檢視這一層驗它管的兩個 UI 狀態怎麼流動（spec 4.2）：
 *
 * - 預設停在「未結清」，列表以 `status=OPEN&page=1` 請求；
 * - 切換狀態分頁以新的 `status` 重新請求，**並回到第 1 頁**——先翻到第 2 頁再切，
 *   才證明得出「回到第 1 頁」不是碰巧；
 * - 點一列會把那筆的 id 交給 `onSelectDebt`。
 *
 * 策略：mock fetch（比照 `use-transactions.test.tsx`），列表依網址上的 status 與
 * page 回不同的資料，再從 fetch 的呼叫參數斷言送出的查詢字串。
 */
describe('DebtsView', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  /** 每個狀態各一筆，名字跟著狀態走，斷言時看得出目前顯示的是哪個分頁的資料。 */
  const debtOf = (status: Debt['status']): Debt => ({
    id: `debt-${status}`,
    direction: 'LENT',
    counterpartyName: { OPEN: '小明', SETTLED: '阿華', FORGIVEN: '老王' }[status],
    principal: 5000,
    date: '2026-09-01T04:00:00.000Z',
    note: null,
    outstanding: status === 'OPEN' ? 3000 : 0,
    status,
    settlementDifference: null,
    transactionId: 'txn-1',
    payments: [],
    forgivenAt: null,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // 列表依網址上的 status/page 回該狀態那一筆。total 刻意大於 limit，
    // 分頁列才會出現（Pagination 只有一頁時整個不渲染）。
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/debts/summary')) {
        return json({ items: [{ counterpartyName: '小明', counterpartyUserId: null, net: 5000 }] });
      }
      if (url.includes('/debts')) {
        const query = new URL(url).searchParams;
        const status = (query.get('status') ?? 'OPEN') as Debt['status'];
        return json({
          items: [debtOf(status)],
          page: Number(query.get('page') ?? 1),
          limit: 20,
          total: 42,
        });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderView(onSelectDebt = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <DebtsView onSelectDebt={onSelectDebt} />
      </QueryClientProvider>,
    );
    return onSelectDebt;
  }

  /** `/debts`（列表）的請求網址，按呼叫順序。淨額與列表是不同的請求，要過濾。 */
  const listRequests = () =>
    fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/debts') && !url.includes('/debts/summary'));

  it('notes debts are not per-ledger and opens on the open tab', async () => {
    renderView();

    expect(screen.getByText('借還紀錄不分帳本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未結清' })).toHaveAttribute('aria-pressed', 'true');

    // 預設分頁的列表：未結清那一筆（小明），請求帶 status=OPEN&page=1。
    expect(await screen.findByRole('button', { name: /借給小明/ })).toBeInTheDocument();
    expect(listRequests().at(-1)).toMatch(/\/debts\?status=OPEN&page=1&limit=20$/);
  });

  it('re-requests with the new status and resets to page 1 when the tab changes', async () => {
    const user = userEvent.setup();
    renderView();

    await screen.findByRole('button', { name: /借給小明/ });

    // 先翻到第 2 頁——不先離開第 1 頁，驗不出「切分頁會回到第 1 頁」。
    await user.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() =>
      expect(listRequests().at(-1)).toMatch(/\/debts\?status=OPEN&page=2&limit=20$/),
    );

    await user.click(screen.getByRole('button', { name: '已結清' }));

    // 新狀態的請求：status 換掉、頁碼歸 1，列表換成已結清那一筆（阿華）。
    await waitFor(() =>
      expect(listRequests().at(-1)).toMatch(/\/debts\?status=SETTLED&page=1&limit=20$/),
    );
    expect(await screen.findByRole('button', { name: /借給阿華/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已結清' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the clicked debt id through onSelectDebt', async () => {
    const onSelectDebt = vi.fn();
    const user = userEvent.setup();
    renderView(onSelectDebt);

    await user.click(await screen.findByRole('button', { name: /借給小明/ }));

    expect(onSelectDebt).toHaveBeenCalledWith('debt-OPEN');
  });
});
