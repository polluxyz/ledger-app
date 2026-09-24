import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => vi.unstubAllGlobals());

  function respondWith(balance: number, items: unknown[] = [baseEntry], total = items.length) {
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
      if (url.includes('/counterparties/cp-1')) {
        return json({
          id: 'cp-1',
          name: '小明',
          balance,
          createdAt: '2026-09-01T04:00:00.000Z',
          updatedAt: '2026-09-01T04:00:00.000Z',
        });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  function renderDetail(balance = 9, items: unknown[] = [baseEntry], total = items.length) {
    const onRecordEntry = vi.fn();
    const onDeleted = vi.fn();
    respondWith(balance, items, total);
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

  it('shows forgive only for a positive balance and delete-counterparty only with no entries', async () => {
    const firstRender = renderDetail(9, [baseEntry], 1);
    await screen.findByText('小明欠你 $9');
    expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();

    firstRender.unmount();
    renderDetail(-11, [], 0);
    await screen.findByText('你欠小明 $11');
    expect(screen.queryByRole('button', { name: '免除剩餘' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除對象' })).toBeInTheDocument();
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
  });

  it('confirms forgiveness with the API balance amount', async () => {
    const user = userEvent.setup();
    renderDetail(50);
    await screen.findByText('小明欠你 $50');
    await user.click(screen.getByRole('button', { name: '免除剩餘' }));

    const confirmation = await screen.findByRole('dialog', { name: '免除剩餘' });
    expect(
      within(confirmation).getByText(
        '小明欠你的 $50 將歸零，不產生交易；之後可以刪除這筆免除來還原。',
      ),
    ).toBeInTheDocument();
  });
});
