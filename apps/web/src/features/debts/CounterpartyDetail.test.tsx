import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CounterpartyDetail } from './CounterpartyDetail';

/**
 * CounterpartyDetail 驗 API 餘額、紀錄呈現與帳的操作（修改、刪除、免除）。修訂 2 起
 * 只留帳（W55）：管理按鈕搬到對象頁的 CounterpartyProfile，這裡一顆都不能出現（SC-W63）。
 */
describe('CounterpartyDetail', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const baseEntry = {
    id: 'entry-1',
    counterpartyId: 'cp-1',
    kind: 'LEND',
    delta: 12000,
    date: '2026-09-01T04:00:00.000Z',
    note: '借款',
    transactionId: 'txn-1',
    splitId: null,
    balanceAfter: 12000,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };

  const linkedUser = { userId: 'user-2', userName: '王小明', theirBalance: 987600 };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function respondWith(
    balance: number,
    items: unknown[] = [baseEntry],
    total = items.length,
    options: {
      link?: Counterparty['link'];
      name?: string | null;
      displayName?: string;
      ledgerParts?: Counterparty['ledgerParts'];
    } = {},
  ) {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties/cp-1/entries')) {
        return json({ items, page: 1, limit: 20, total });
      }
      if (url.endsWith('/counterparties/cp-1/link')) {
        return json({});
      }
      if (url.includes('/counterparties/cp-1')) {
        const name = options.name === undefined ? (options.link ? null : '小明') : options.name;
        return json({
          id: 'cp-1',
          name,
          displayName: options.displayName ?? name ?? options.link?.userName ?? '小明',
          askMerge: false,
          balance,
          totalBalance: balance,
          ledgerParts: options.ledgerParts ?? [],
          link: options.link ?? null,
          createdAt: '2026-09-01T04:00:00.000Z',
          updatedAt: '2026-09-01T04:00:00.000Z',
        });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  function renderDetail(
    balance = 900,
    items: unknown[] = [baseEntry],
    total = items.length,
    options: {
      link?: Counterparty['link'];
      name?: string | null;
      displayName?: string;
      ledgerParts?: Counterparty['ledgerParts'];
    } = {},
  ) {
    const onRecordEntry = vi.fn();
    const onEditSplit = vi.fn();
    respondWith(balance, items, total, options);
    const result = render(
      <MemoryRouter initialEntries={['/transactions?view=debts']}>
        <QueryClientProvider client={queryClient}>
          <CounterpartyDetail
            counterpartyId="cp-1"
            onRecordEntry={onRecordEntry}
            onEditSplit={onEditSplit}
          />
        </QueryClientProvider>
        <LocationProbe />
      </MemoryRouter>,
    );
    return { onRecordEntry, onEditSplit, ...result };
  }

  it.each([
    [900, '小明欠你 $9'],
    [-1100, '你欠小明 $11'],
    [0, '兩清'],
  ])('shows the API balance phrase for balance %i', async (balance, phrase) => {
    renderDetail(balance);
    expect(await screen.findByText(phrase)).toBeInTheDocument();
  });

  it('passes the current counterparty name to 記一筆', async () => {
    const user = userEvent.setup();
    const { onRecordEntry } = renderDetail();
    await screen.findByText('小明欠你 $9');

    await user.click(screen.getByRole('button', { name: '記一筆' }));

    expect(onRecordEntry).toHaveBeenCalledWith('小明');
  });

  it('shows shared ledgers below the personal balance and opens their settle intent', async () => {
    const user = userEvent.setup();
    const source = {
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-ming',
      personName: '明哥',
      amount: 51200,
      left: false,
    };
    renderDetail(900, [baseEntry], 1, { ledgerParts: [source] });

    expect(await screen.findByRole('heading', { name: '共享帳本' })).toBeInTheDocument();
    expect(screen.getByText('明哥欠你 $512')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /開啟 花蓮三日 的結清/ }));

    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? '{}')).toEqual({
      pathname: '/transactions',
      search: '?view=settle',
      state: {
        settleIntent: { ledgerId: 'ledger-hualien', personId: 'person-ming', amount: 51200 },
      },
    });
  });

  it('opens the read-only history for an exited shared ledger', async () => {
    const user = userEvent.setup();
    const source = {
      ledgerId: 'ledger-old-home',
      ledgerName: '老家',
      personId: 'person-old-home',
      personName: '小明',
      amount: -2500,
      left: true,
    };
    renderDetail(900, [baseEntry], 1, { ledgerParts: [source] });

    await user.click(await screen.findByRole('button', { name: /唯讀畫面/ }));

    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? '{}')).toEqual({
      pathname: '/ledgers/ledger-old-home/history',
      search: '',
      state: null,
    });
  });

  it('keeps only the account: no counterparty management buttons (SC-W63)', async () => {
    renderDetail(900, [baseEntry], 1, {
      link: linkedUser,
      name: '小明',
      displayName: '小明',
    });

    expect(await screen.findByText('小明欠你 $9')).toBeInTheDocument();
    // 帳的內容都在：餘額、記一筆、免除剩餘（對方欠我時）與往來紀錄。
    expect(screen.getByRole('button', { name: '記一筆' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '往來紀錄' })).toBeInTheDocument();
    // 管理按鈕搬到對象頁（W53），這裡一顆都不能出現。
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設定暱稱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '合併之前的紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解除連動' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();
    // 標題只有名字與連動標記，不再顯示帳號名稱小字（W55）。
    expect(screen.queryByText('王小明')).not.toBeInTheDocument();
  });

  it('shows Chinese entry kinds, signed deltas, API balances, notes, and the unrecorded label', async () => {
    const entries = [
      { ...baseEntry, id: 'lend', kind: 'LEND', delta: 12000, balanceAfter: 12000 },
      {
        ...baseEntry,
        id: 'borrow',
        kind: 'BORROW',
        delta: -11100,
        balanceAfter: 900,
        transactionId: null,
        note: null,
      },
      { ...baseEntry, id: 'collect', kind: 'COLLECT', delta: 3000 },
      { ...baseEntry, id: 'repay', kind: 'REPAY', delta: 4000 },
      { ...baseEntry, id: 'paid', kind: 'PAID_FOR_ME', delta: -5000, balanceAfter: -1100 },
      {
        ...baseEntry,
        id: 'settlement',
        kind: 'SETTLEMENT',
        delta: -800,
        balanceAfter: 0,
        transactionId: null,
      },
      {
        ...baseEntry,
        id: 'forgive',
        kind: 'FORGIVE',
        delta: -900,
        balanceAfter: 0,
        transactionId: null,
      },
    ];
    renderDetail(0, entries, entries.length);

    for (const kind of ['借出', '借入', '對方還我', '我還對方', '幫我付', '結清差額', '免除']) {
      expect(await screen.findByText(kind)).toBeInTheDocument();
    }
    expect(screen.getByText('+$120')).toBeInTheDocument();
    expect(screen.getByText('−$111')).toBeInTheDocument();
    expect(screen.getAllByText('餘額 $120').length).toBeGreaterThan(0);
    expect(screen.getByText('餘額 $9')).toBeInTheDocument();
    expect(screen.getByText('餘額 −$11')).toBeInTheDocument();
    expect(screen.getByText('未記帳')).toBeInTheDocument();
    expect(screen.getAllByText('借款').length).toBeGreaterThan(0);
  });

  it('shows the three API sync labels and leaves NONE unmarked', async () => {
    const entries = [
      { ...baseEntry, id: 'pending', sync: 'PENDING' },
      { ...baseEntry, id: 'synced', sync: 'SYNCED' },
      { ...baseEntry, id: 'declined', sync: 'DECLINED' },
      { ...baseEntry, id: 'none', sync: 'NONE' },
    ];
    renderDetail(0, entries, entries.length);

    expect(await screen.findByText('等對方確認')).toBeInTheDocument();
    expect(screen.getByText('已同步')).toBeInTheDocument();
    expect(screen.getByText('對方未接受')).toBeInTheDocument();
    expect(screen.queryByText('NONE')).not.toBeInTheDocument();
  });

  it('does not offer edit for settlement or forgiveness adjustments', async () => {
    const entries = [
      { ...baseEntry, id: 'settlement', kind: 'SETTLEMENT' },
      { ...baseEntry, id: 'forgive', kind: 'FORGIVE' },
    ];
    renderDetail(0, entries, entries.length);

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).queryByRole('button', { name: '修改' })).not.toBeInTheDocument();
      expect(within(row).getByRole('button', { name: '刪除' })).toBeInTheDocument();
    }
  });

  it('opens split entries through the split editor and hides entry edits', async () => {
    const user = userEvent.setup();
    const { onEditSplit } = renderDetail(0, [{ ...baseEntry, splitId: 'split-1' }]);
    const entryRow = (await screen.findAllByRole('listitem'))[0];
    if (!entryRow) throw new Error('往來紀錄列不存在');

    expect(within(entryRow).getByRole('button', { name: '分帳' })).toBeInTheDocument();
    expect(within(entryRow).queryByRole('button', { name: '修改' })).not.toBeInTheDocument();
    expect(within(entryRow).queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
    await user.click(within(entryRow).getByRole('button', { name: '分帳' }));
    expect(onEditSplit).toHaveBeenCalledWith('split-1');
  });

  it('confirms entry deletion with its linked transaction and balance consequences', async () => {
    const user = userEvent.setup();
    renderDetail();
    const entryRow = (await screen.findAllByRole('listitem'))[0];
    if (!entryRow) {
      throw new Error('往來紀錄列不存在');
    }
    await user.click(within(entryRow).getByRole('button', { name: '刪除' }));

    const confirmation = await screen.findByRole('dialog', { name: '刪除往來紀錄' });
    expect(
      within(confirmation).getByText(
        '刪除這筆往來？對應的交易會一起刪除，帳戶餘額與往來餘額會回到記這筆之前。',
      ),
    ).toBeInTheDocument();
    expect(confirmation).not.toHaveTextContent('這筆已和');
  });

  it('adds the paired deletion explanation', async () => {
    const user = userEvent.setup();
    const pairedEntry = { ...baseEntry, paired: true };
    renderDetail(900, [pairedEntry], 1, {
      link: linkedUser,
      name: '小明',
      displayName: '小明',
    });
    const row = (await screen.findAllByRole('listitem'))[0];
    if (!row) {
      throw new Error('往來紀錄列不存在');
    }
    await user.click(within(row).getByRole('button', { name: '刪除' }));

    const deleteDialog = await screen.findByRole('dialog', { name: '刪除往來紀錄' });
    expect(deleteDialog).toHaveTextContent('刪除這筆往來？');
    expect(deleteDialog).toHaveTextContent('會請小明也刪除');
    expect(deleteDialog).not.toHaveTextContent('他不接受的話');
  });

  it('confirms forgiveness with the API balance amount', async () => {
    const user = userEvent.setup();
    renderDetail(5000);
    await screen.findByText('小明欠你 $50');
    await user.click(screen.getByRole('button', { name: '免除剩餘' }));

    const confirmation = await screen.findByRole('dialog', { name: '免除剩餘' });
    // 免除會把欠款歸零，和錢有關，所以留一句短話說明金額（W44 的例外）。
    expect(within(confirmation).getByText('小明欠你的 $50 將歸零')).toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  const state: unknown = location.state;
  return (
    <output data-testid="location-state">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        state,
      })}
    </output>
  );
}
