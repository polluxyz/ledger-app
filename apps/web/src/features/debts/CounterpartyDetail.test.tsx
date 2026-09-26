import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { CounterpartyDetail } from './CounterpartyDetail';

/** CounterpartyDetail 驗 API 餘額、紀錄呈現，以及只在符合條件時出現的操作。 */
describe('CounterpartyDetail', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const baseEntry = {
    id: 'entry-1',
    counterpartyId: 'cp-1',
    kind: 'LEND',
    delta: 120,
    date: '2026-09-01T04:00:00.000Z',
    note: '借款',
    transactionId: 'txn-1',
    balanceAfter: 120,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };

  const linkedUser = { userId: 'user-2', userName: '王小明', theirBalance: 9876 };

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
          link: options.link ?? null,
          createdAt: '2026-09-01T04:00:00.000Z',
          updatedAt: '2026-09-01T04:00:00.000Z',
        });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  function renderDetail(
    balance = 9,
    items: unknown[] = [baseEntry],
    total = items.length,
    options: {
      link?: Counterparty['link'];
      name?: string | null;
      displayName?: string;
    } = {},
  ) {
    const onRecordEntry = vi.fn();
    const onDeleted = vi.fn();
    respondWith(balance, items, total, options);
    const result = render(
      <QueryClientProvider client={queryClient}>
        <CounterpartyDetail
          counterpartyId="cp-1"
          onRecordEntry={onRecordEntry}
          onDeleted={onDeleted}
        />
      </QueryClientProvider>,
    );
    return { onRecordEntry, onDeleted, ...result };
  }

  it.each([
    [9, '小明欠你 $9'],
    [-11, '你欠小明 $11'],
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

  it('shows unlinked management actions and delete only when no entries remain', async () => {
    const firstRender = renderDetail(9, [baseEntry], 1);
    await screen.findByText('小明欠你 $9');
    expect(screen.getByRole('button', { name: '記一筆' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '邀請連動' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '合併之前的紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解除連動' })).not.toBeInTheDocument();

    firstRender.unmount();
    renderDetail(-11, [], 0);
    await screen.findByText('你欠小明 $11');
    expect(screen.queryByRole('button', { name: '免除剩餘' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除對象' })).toBeInTheDocument();
  });

  it('shows linked management actions and the account name below a nickname', async () => {
    const { container } = renderDetail(9, [], 0, {
      link: linkedUser,
      name: '內部暱稱',
      displayName: '小明的暱稱',
    });

    expect(await screen.findByRole('heading', { name: '小明的暱稱' })).toBeInTheDocument();
    expect(screen.getByText('小明的暱稱欠你 $9')).toBeInTheDocument();
    expect(screen.getByText('王小明', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '設定暱稱' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '記一筆' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '合併之前的紀錄' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解除連動' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '邀請連動' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('已和 王小明 連動');
    expect(container).not.toHaveTextContent('$9,876');
    expect(container).not.toHaveTextContent('好友');
  });

  it('uses the account name once when a linked counterparty has no nickname', async () => {
    renderDetail(9, [], 0, { link: linkedUser, name: null, displayName: '王小明' });

    expect(await screen.findByRole('heading', { name: '王小明' })).toBeInTheDocument();
    expect(screen.getAllByText('王小明', { exact: true })).toHaveLength(1);
  });

  it('shows Chinese entry kinds, signed deltas, API balances, notes, and the unrecorded label', async () => {
    const entries = [
      { ...baseEntry, id: 'lend', kind: 'LEND', delta: 120, balanceAfter: 120 },
      {
        ...baseEntry,
        id: 'borrow',
        kind: 'BORROW',
        delta: -111,
        balanceAfter: 9,
        transactionId: null,
        note: null,
      },
      { ...baseEntry, id: 'collect', kind: 'COLLECT', delta: 30 },
      { ...baseEntry, id: 'repay', kind: 'REPAY', delta: 40 },
      { ...baseEntry, id: 'paid', kind: 'PAID_FOR_ME', delta: -50, balanceAfter: -11 },
      {
        ...baseEntry,
        id: 'settlement',
        kind: 'SETTLEMENT',
        delta: -8,
        balanceAfter: 0,
        transactionId: null,
      },
      {
        ...baseEntry,
        id: 'forgive',
        kind: 'FORGIVE',
        delta: -9,
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

  it('adds the paired deletion explanation and unlinks after the specified confirmation', async () => {
    const user = userEvent.setup();
    const pairedEntry = { ...baseEntry, paired: true };
    renderDetail(9, [pairedEntry], 1, {
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
    await user.click(within(deleteDialog).getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: '解除連動' }));
    const unlinkDialog = await screen.findByRole('dialog', { name: '解除和小明的連動' });
    expect(unlinkDialog).toHaveTextContent('名字和紀錄都會保留');
    expect(unlinkDialog).not.toHaveTextContent('之後想再連動');
    await user.click(within(unlinkDialog).getByRole('button', { name: '解除連動' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            typeof url === 'string' &&
            url.includes('/counterparties/cp-1/link') &&
            (options as RequestInit).method === 'DELETE',
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '解除和小明的連動' })).toBeNull(),
    );
  });

  it('confirms forgiveness with the API balance amount', async () => {
    const user = userEvent.setup();
    renderDetail(50);
    await screen.findByText('小明欠你 $50');
    await user.click(screen.getByRole('button', { name: '免除剩餘' }));

    const confirmation = await screen.findByRole('dialog', { name: '免除剩餘' });
    // 免除會把欠款歸零，和錢有關，所以留一句短話說明金額（W44 的例外）。
    expect(within(confirmation).getByText('小明欠你的 $50 將歸零')).toBeInTheDocument();
  });
});
