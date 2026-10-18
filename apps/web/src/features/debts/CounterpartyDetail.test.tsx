import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty, LedgerSummary } from '@ledger/shared';
import { MemoryRouter } from 'react-router-dom';
import { CounterpartyDetail } from './CounterpartyDetail';

/**
 * CounterpartyDetail 驗兩種分頁的唯讀內容、未還清分組、歷史與個人操作。
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
    recorded: {
      ledgerId: 'ledger-1',
      accountId: 'account-1',
      title: null,
      categoryId: null,
      categoryIcon: null,
    },
    splitId: null,
    settlesEntryId: null,
    difference: null,
    balanceAfter: 12000,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
  };

  const linkedUser = { userId: 'user-2', userName: '王小明', theirBalance: 987600 };
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const counterpartyForForm = {
    id: 'cp-1',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    balance: 900,
    totalBalance: 900,
    ledgerParts: [],
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

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
      entryPages?: Record<number, unknown[]>;
      ledgers?: LedgerSummary[];
    } = {},
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.endsWith('/counterparties/cp-1/entries')) {
        const page = Number(parsedUrl.searchParams.get('page') ?? 1);
        const limit = Number(parsedUrl.searchParams.get('limit') ?? 20);
        return json({ items: options.entryPages?.[page] ?? items, page, limit, total });
      }
      if (url.includes('/debt-entries') && init?.method === 'POST') {
        return json(
          { counterparty: { ...counterpartyForForm, balance: balance + 100 }, entries: [] },
          201,
        );
      }
      if (url.endsWith('/counterparties?limit=100')) {
        return json({ items: [counterpartyForForm], page: 1, limit: 100, total: 1 });
      }
      if (url.endsWith('/accounts')) {
        return json([
          {
            id: 'account-1',
            name: '現金',
            initialBalance: 0,
            balance: 0,
            isTemporary: false,
            hasTransactions: false,
          },
        ]);
      }
      if (parsedUrl.pathname.endsWith('/ledgers')) {
        return json(options.ledgers ?? [ledger]);
      }
      if (url.includes('/users/me/record-defaults')) {
        return json({ ledgerId: 'ledger-1', accountId: 'account-1' });
      }
      if (url.endsWith('/counterparties/cp-1/forgive') && init?.method === 'POST') {
        return json({ counterparty: counterpartyForForm, entries: [] }, 201);
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
      entryPages?: Record<number, unknown[]>;
      ledgers?: LedgerSummary[];
    } = {},
    mode: 'overview' | 'personal' = 'personal',
    selectedLedger: LedgerSummary = ledger,
  ) {
    const onEditSplit = vi.fn();
    respondWith(balance, items, total, options);
    const result = render(
      <MemoryRouter initialEntries={['/transactions?view=debts']}>
        <QueryClientProvider client={queryClient}>
          <CounterpartyDetail
            ledger={selectedLedger}
            counterpartyId="cp-1"
            mode={mode}
            onEditSplit={onEditSplit}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return { onEditSplit, ...result };
  }

  it('omits duplicate balance arrow and heading in expanded detail (debts-tabs2)', async () => {
    renderDetail(900);
    expect(await screen.findByText('借款')).toBeInTheDocument();
    expect(screen.queryByText('小明欠你 $9')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument();
  });

  it('requests outstanding entries and appends the next API page after loading more', async () => {
    const user = userEvent.setup();
    const firstEntry = { ...baseEntry, id: 'entry-first', note: '第一頁紀錄' };
    const secondEntry = { ...baseEntry, id: 'entry-second', note: '第二頁紀錄' };
    renderDetail(900, [firstEntry], 21, { entryPages: { 2: [secondEntry] } });

    expect(await screen.findByText('第一頁紀錄')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).match(/\/counterparties\/cp-1\/entries\?section=outstanding&page=1&limit=20$/),
      ),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: '載入更多' }));

    expect(await screen.findByText('第二頁紀錄')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).match(/\/counterparties\/cp-1\/entries\?section=outstanding&page=2&limit=20$/),
      ),
    ).toBe(true);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('title'))).toEqual([
      '我借給小明 $120',
      '我借給小明 $120',
    ]);
    expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument();
  });

  it('opens a prefilled form above the entries and lets the user cancel it', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText('借款');

    await user.click(screen.getByRole('button', { name: '記一筆' }));

    const form = await screen.findByRole('button', { name: '取消' });
    expect(screen.getByLabelText('對象')).toHaveValue('小明');

    await user.click(form);
    await waitFor(() => expect(screen.queryByLabelText('對象')).not.toBeInTheDocument());
  });

  it('closes the inline form after a successful entry save', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: '記一筆' }));
    await user.type(await screen.findByLabelText('金額'), '1');
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(screen.queryByLabelText('對象')).not.toBeInTheDocument());
  });

  it('shows each shared ledger as a heading with read-only rows in the overview', async () => {
    const source = {
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-ming',
      personName: '明哥',
      amount: 51200,
      left: false,
    };
    renderDetail(900, [baseEntry], 1, { ledgerParts: [source] }, 'overview');

    expect(await screen.findByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '共享帳本' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '明哥欠你 $512' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /花蓮三日/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /記一筆|免除剩餘|修改|撤銷|分帳/ }),
    ).not.toBeInTheDocument();
  });

  it('places outstanding entries before the shared ledger groups', async () => {
    const source = {
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-ming',
      personName: '明哥',
      amount: 51200,
      left: false,
    };
    renderDetail(900, [baseEntry], 1, { ledgerParts: [source] }, 'overview');

    const note = await screen.findByText('借款');
    const ledgerHeading = await screen.findByRole('heading', { name: '花蓮三日' });
    expect(
      note.compareDocumentPosition(ledgerHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps an exited shared source read-only in the overview', async () => {
    const source = {
      ledgerId: 'ledger-old-home',
      ledgerName: '老家',
      personId: 'person-old-home',
      personName: '小明',
      amount: -2500,
      left: true,
    };
    renderDetail(900, [baseEntry], 1, { ledgerParts: [source] }, 'overview');

    expect(await screen.findByText('已退出')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /老家/ })).not.toBeInTheDocument();
  });

  it('shares avatar labels across the counterparty, ledger people, and entries in the expanded block', async () => {
    const source = {
      ledgerId: 'ledger-hualien',
      ledgerName: '花蓮三日',
      personId: 'person-hua',
      personName: '小華',
      amount: 51200,
      left: false,
    };
    renderDetail(900, [baseEntry], 1, { displayName: '小明', ledgerParts: [source] }, 'overview');

    await screen.findByRole('heading', { name: '花蓮三日' });
    expect(screen.getByTitle('小華')).toHaveTextContent('華');
    expect(screen.getByTitle('小明')).toHaveTextContent('明');
    for (const avatar of screen.getAllByTitle('我')) {
      expect(avatar).toHaveTextContent('我');
    }
  });

  it('renders the outstanding section returned by the API and omits history navigation', async () => {
    const entries = [{ ...baseEntry, id: 'outstanding', balanceAfter: 3000, note: '未還清' }];
    renderDetail(3000, entries, entries.length);

    expect(await screen.findByText('未還清')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('section=outstanding'))).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: '歷史' })).not.toBeInTheDocument();
  });

  it('shows entry actions from each recorded ledger and keeps legacy entries on the selected-ledger rule', async () => {
    const writableLedger: LedgerSummary = { ...ledger, id: 'ledger-writable', role: 'EDITOR' };
    const viewerLedger: LedgerSummary = { ...ledger, id: 'ledger-viewer', role: 'VIEWER' };
    const archivedLedger: LedgerSummary = {
      ...ledger,
      id: 'ledger-archived',
      archivedAt: '2026-09-15T00:00:00.000Z',
    };
    const recordedEntry = (id: string, ledgerId: string) => ({
      ...baseEntry,
      id,
      recorded: { ...baseEntry.recorded, ledgerId },
    });
    const entries = [
      recordedEntry('writable', writableLedger.id),
      recordedEntry('viewer', viewerLedger.id),
      recordedEntry('archived', archivedLedger.id),
      { ...baseEntry, id: 'legacy', recorded: null },
    ];

    renderDetail(
      900,
      entries,
      entries.length,
      { ledgers: [writableLedger, viewerLedger, archivedLedger] },
      'personal',
      viewerLedger,
    );

    await waitFor(() => {
      const rows = screen.getAllByRole('listitem');
      expect(within(rows[0]!).getByRole('button', { name: '更多操作' })).toBeInTheDocument();
      for (const row of rows.slice(1)) {
        expect(within(row).queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
      }
    });
    expect(
      fetchMock.mock.calls.some(
        ([url]) => new URL(String(url)).searchParams.get('includeArchived') === 'true',
      ),
    ).toBe(true);
  });

  it('keeps only the account: no counterparty management buttons (SC-W63)', async () => {
    renderDetail(900, [baseEntry], 1, {
      link: linkedUser,
      name: '小明',
      displayName: '小明',
    });

    expect(await screen.findByText('借款')).toBeInTheDocument();
    // 帳的內容都在：記一筆、免除剩餘（對方欠我時），不顯示重複的箭頭與標題。
    expect(screen.getByRole('button', { name: '記一筆' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來紀錄' })).not.toBeInTheDocument();
    // 管理按鈕搬到對象頁（W53），這裡一顆都不能出現。
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設定暱稱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '合併之前的紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解除連動' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();
    // 名字與連動標記已由清單列承載，明細不再重複顯示標題。
    expect(screen.queryByRole('heading', { name: '小明' })).not.toBeInTheDocument();
    expect(screen.queryByText('王小明')).not.toBeInTheDocument();
  });

  it('labels each entry row with a full sentence and drops verb phrases and running balances', async () => {
    const entries = [
      { ...baseEntry, id: 'lend', kind: 'LEND', delta: 12000, balanceAfter: 12000 },
      {
        ...baseEntry,
        id: 'borrow',
        kind: 'BORROW',
        delta: -11100,
        balanceAfter: 900,
        transactionId: null,
        recorded: null,
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
        balanceAfter: 100,
        transactionId: null,
        recorded: null,
      },
      {
        ...baseEntry,
        id: 'forgive',
        kind: 'FORGIVE',
        delta: -900,
        balanceAfter: 200,
        transactionId: null,
        recorded: null,
      },
    ];
    renderDetail(0, entries, entries.length);

    // 每列的 title 就是完整說明句（可存取名稱同值），方向與金額都在句子裡。
    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('title'))).toEqual([
      '我借給小明 $120',
      '我向小明借 $111',
      '小明還我 $30',
      '我還小明 $40',
      '小明幫我付 $50',
      '我和小明結清差額 $8',
      '我免除小明欠我的 $9',
    ]);
    // 金額不帶正負號（D1），也不再顯示逐筆「餘額」（D2）與動詞片語。
    const [firstRow] = rows;
    if (!firstRow) throw new Error('往來紀錄列不存在');
    expect(within(firstRow).getByText('$120')).toBeInTheDocument();
    expect(screen.queryByText('+$120')).not.toBeInTheDocument();
    expect(screen.queryByText('−$111')).not.toBeInTheDocument();
    expect(screen.queryByText(/餘額/)).not.toBeInTheDocument();
    for (const phrase of ['借出', '借入', '對方還我', '我還對方', '幫我付', '結清差額', '免除']) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
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
    const user = userEvent.setup();
    const entries = [
      { ...baseEntry, id: 'settlement', kind: 'SETTLEMENT' },
      { ...baseEntry, id: 'forgive', kind: 'FORGIVE' },
    ];
    renderDetail(0, entries, entries.length);

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      await user.click(within(row).getByRole('button', { name: '更多操作' }));
      const menu = within(row).getByRole('menu');
      expect(within(menu).queryByRole('menuitem', { name: '修改' })).not.toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: '撤銷' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
    }
  });

  it('labels split entries with a badge and routes both menu actions to the split', async () => {
    const user = userEvent.setup();
    const { onEditSplit } = renderDetail(0, [{ ...baseEntry, splitId: 'split-1' }]);
    const entryRow = (await screen.findAllByRole('listitem'))[0];
    if (!entryRow) throw new Error('往來紀錄列不存在');

    expect(within(entryRow).getByText('分帳')).toBeInTheDocument();
    await user.click(within(entryRow).getByRole('button', { name: '更多操作' }));
    const menu = within(entryRow).getByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: '修改' }));
    expect(onEditSplit).toHaveBeenCalledWith('split-1');

    await user.click(within(entryRow).getByRole('button', { name: '更多操作' }));
    await user.click(
      within(within(entryRow).getByRole('menu')).getByRole('menuitem', { name: '撤銷' }),
    );
    expect(await screen.findByRole('dialog', { name: '撤銷這筆？' })).toBeInTheDocument();
  });

  it('previews the entry undo balance before confirming', async () => {
    const user = userEvent.setup();
    renderDetail();
    const entryRow = (await screen.findAllByRole('listitem'))[0];
    if (!entryRow) {
      throw new Error('往來紀錄列不存在');
    }
    await user.click(within(entryRow).getByRole('button', { name: '更多操作' }));
    await user.click(
      within(within(entryRow).getByRole('menu')).getByRole('menuitem', { name: '撤銷' }),
    );

    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(
      within(confirmation).getByRole('group', {
        name: '撤銷後，往來從「小明欠你的金額 $9」變成「你欠小明的金額 $111」。',
      }),
    ).toBeInTheDocument();
    expect(confirmation).not.toHaveTextContent('對應的交易會一起刪除');
  });

  it('shows the synced notification on a paired entry undo preview', async () => {
    const user = userEvent.setup();
    const pairedEntry = { ...baseEntry, paired: true, sync: 'SYNCED' as const };
    renderDetail(900, [pairedEntry], 1, {
      link: linkedUser,
      name: '小明',
      displayName: '小明',
    });
    const row = (await screen.findAllByRole('listitem'))[0];
    if (!row) {
      throw new Error('往來紀錄列不存在');
    }
    await user.click(within(row).getByRole('button', { name: '更多操作' }));
    await user.click(within(within(row).getByRole('menu')).getByRole('menuitem', { name: '撤銷' }));

    const undoDialog = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(undoDialog).toHaveTextContent('對方會收到通知');
    expect(undoDialog).not.toHaveTextContent('會請小明也刪除');
  });

  it('uses the selected ledger to forgive without a ledger picker', async () => {
    const user = userEvent.setup();
    renderDetail(5000);
    const forgiveButton = await screen.findByRole('button', { name: '免除剩餘' });
    await user.click(forgiveButton);

    const confirmation = await screen.findByRole('dialog', { name: '免除剩餘' });
    expect(within(confirmation).queryByLabelText('帳本')).not.toBeInTheDocument();
    expect(within(confirmation).queryByText(/小明欠你的/)).not.toBeInTheDocument();
    expect(within(confirmation).getByRole('button', { name: '取消' })).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: '免除' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/counterparties/cp-1/forgive'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ledgerId: 'ledger-1' }) }),
      );
    });
  });

  it('hides recording and forgiveness actions on a viewer ledger', async () => {
    renderDetail(5000, [baseEntry], 1, {}, 'personal', { ...ledger, role: 'VIEWER' });
    await screen.findByText('借款');

    expect(screen.queryByRole('button', { name: '記一筆' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '免除剩餘' })).not.toBeInTheDocument();
  });
});
