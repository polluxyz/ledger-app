import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt } from '@ledger/shared';
import { formatDate, formatMoney } from '../../lib/format';
import { DebtList } from './DebtList';

/**
 * 債務列表這一層驗「拿到 API 的數字之後怎麼畫」（spec 4.2）：
 *
 * - 方向與對方合成「借給小明／向阿華借」，OPEN 顯示「剩 $X」、其他顯示狀態文字；
 * - 舊債（`transactionId === null`）加標籤，有交易的沒有；
 * - 整列可點，點了把那筆的 id 交給 `onSelectDebt`；
 * - 篩選條件（status、page、limit）原樣進查詢字串——前端不自行過濾。
 *
 * 金額與狀態全部用測資裡的數字斷言（W9：前端不算錢），日期用 `formatDate`
 * 對同一個 ISO 字串算預期值——測的是「列上顯示格式化後的日期」，不是時區換算。
 */
describe('DebtList', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  /** 一筆未結清、沒有交易的借出（＝舊債）。 */
  const lentDebt: Debt = {
    id: 'debt-1',
    direction: 'LENT',
    counterpartyName: '小明',
    principal: 5000,
    date: '2026-09-01T04:00:00.000Z',
    note: null,
    outstanding: 3000,
    status: 'OPEN',
    settlementDifference: null,
    transactionId: null,
    payments: [],
    forgivenAt: null,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderList(
    items: Debt[],
    props: { status?: Debt['status']; page?: number } = {},
    onSelectDebt = vi.fn(),
  ) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/debts')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items, page: props.page ?? 1, limit: 20, total: items.length }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <DebtList
          status={props.status ?? 'OPEN'}
          page={props.page ?? 1}
          onPageChange={vi.fn()}
          onSelectDebt={onSelectDebt}
        />
      </QueryClientProvider>,
    );
  }

  it('renders direction, counterparty, date, principal and outstanding for open debts', async () => {
    const borrowedDebt: Debt = {
      ...lentDebt,
      id: 'debt-2',
      direction: 'BORROWED',
      counterpartyName: '阿華',
      principal: 1200,
      outstanding: 1200,
      transactionId: 'txn-9',
    };
    renderList([lentDebt, borrowedDebt]);

    expect(await screen.findByRole('button', { name: /借給小明/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /向阿華借/ })).toBeInTheDocument();

    const lentRow = screen.getByRole('button', { name: /借給小明/ });
    expect(within(lentRow).getByText(formatDate(lentDebt.date))).toBeInTheDocument();
    expect(within(lentRow).getByText(formatMoney(5000))).toBeInTheDocument();
    // 未清餘額直接取 API 的數字（W9），前面加個「剩」說明它是什麼。
    expect(within(lentRow).getByText(`剩 ${formatMoney(3000)}`)).toBeInTheDocument();
  });

  it('marks debts without a transaction as 舊債', async () => {
    const recordedDebt: Debt = { ...lentDebt, id: 'debt-2', transactionId: 'txn-9' };
    renderList([lentDebt, recordedDebt]);

    // 兩筆的對方都是小明，只能整批拿再逐列看標籤。
    const rows = await screen.findAllByRole('button', { name: /借給小明/ });
    expect(rows).toHaveLength(2);
    // transactionId === null 的那一筆才有標籤——同一畫面有對照，標籤才有意義。
    expect(rows.filter((row) => within(row).queryByText('舊債'))).toHaveLength(1);
  });

  it('shows the status word instead of the outstanding for settled and forgiven debts', async () => {
    const settled: Debt = { ...lentDebt, id: 'debt-s', outstanding: 0, status: 'SETTLED' };
    const forgiven: Debt = {
      ...lentDebt,
      id: 'debt-f',
      status: 'FORGIVEN',
      forgivenAt: '2026-09-02T00:00:00.000Z',
    };
    renderList([settled, forgiven], { status: 'SETTLED' });

    expect(await screen.findByText('已結清')).toBeInTheDocument();
    expect(screen.getByText('已免除')).toBeInTheDocument();
    // 狀態不是 OPEN 就不顯示餘額（spec 4.2）。
    expect(screen.queryByText(/剩 /)).not.toBeInTheDocument();
  });

  it('calls onSelectDebt with the id of the clicked row', async () => {
    const onSelectDebt = vi.fn();
    const user = userEvent.setup();
    renderList([lentDebt], {}, onSelectDebt);

    await user.click(await screen.findByRole('button', { name: /借給小明/ }));

    expect(onSelectDebt).toHaveBeenCalledWith('debt-1');
  });

  it('requests the list with the given status, page and limit', async () => {
    renderList([], { status: 'FORGIVEN', page: 3 });

    await screen.findByText('沒有已免除的借還。');

    const [url] = (fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]) ?? [];
    expect(url).toMatch(/\/debts\?status=FORGIVEN&page=3&limit=20$/);
  });

  it('says which status is empty instead of a generic no-data message', async () => {
    renderList([], { status: 'OPEN' });

    expect(await screen.findByText('沒有未結清的借還。')).toBeInTheDocument();
  });
});
