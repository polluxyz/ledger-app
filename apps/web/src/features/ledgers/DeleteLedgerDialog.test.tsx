import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LedgerLeaveItem,
  LedgerLeavePreview,
  LedgerSummary,
  LeaveRequest,
} from '@ledger/shared';
import { DeleteLedgerDialog } from './DeleteLedgerDialog';

const items: LedgerLeaveItem[] = [
  {
    id: 'item-1',
    date: '2026-10-01T12:00:00.000Z',
    title: '機票訂金',
    categoryIcon: 'travel',
    accountEffects: [{ accountId: 'account-1', name: '現金', delta: -5000 }],
    share: 5000,
    paidByName: null,
    kind: 'SHARED',
  },
  {
    id: 'item-2',
    date: '2026-10-02T12:00:00.000Z',
    title: '存入',
    categoryIcon: 'other',
    accountEffects: [{ accountId: 'account-1', name: '現金', delta: -2000 }],
    share: null,
    paidByName: null,
    kind: 'SHARED',
  },
  {
    id: 'item-3',
    date: '2026-10-03T12:00:00.000Z',
    title: '借給阿德',
    categoryIcon: 'other',
    accountEffects: [{ accountId: 'account-1', name: '現金', delta: -1000 }],
    share: null,
    paidByName: null,
    kind: 'PERSONAL_DEBT',
  },
];

const ledgers: LedgerSummary[] = [
  {
    id: 'ledger-1',
    name: '來源帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  },
  {
    id: 'personal-1',
    name: '日常',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  },
  {
    id: 'shared-1',
    name: '家用',
    currency: 'TWD',
    kind: 'SHARED',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'EDITOR',
  },
  {
    id: 'viewer-1',
    name: '只讀帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'VIEWER',
  },
  {
    id: 'archived-1',
    name: '封存帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  },
];

function makePreview(
  previewItems: LedgerLeaveItem[] = items,
  balanceAfter = 3000,
): LedgerLeavePreview {
  return {
    items: previewItems,
    accounts: previewItems.length
      ? [{ accountId: 'account-1', name: '現金', balance: 12000, balanceAfter }]
      : [],
    carryOvers: [],
    withdrawals: previewItems.length
      ? [
          {
            counterpartyId: 'cp-1',
            displayName: '阿德',
            linked: false,
            balance: 1000,
            balanceAfter: 0,
          },
        ]
      : [],
    leave: { allowed: true, blockedBy: null },
  };
}

/** W194、W195 私人刪除以 vi.mock API 驗證 moves、操作流程與最新預覽；共享帳本保留 3k。 */
describe('DeleteLedgerDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function parseRequestBody(init?: RequestInit): LeaveRequest {
    if (typeof init?.body !== 'string') throw new Error('預期請求帶 JSON body');
    return JSON.parse(init.body) as LeaveRequest;
  }

  function renderDialog(
    options: {
      kind?: 'PERSONAL' | 'SHARED';
      previewItems?: LedgerLeaveItem[];
      previewFactory?: (request: LeaveRequest) => Response | Promise<Response>;
      ledgerList?: LedgerSummary[];
    } = {},
  ) {
    const previewBodies: LeaveRequest[] = [];
    const leaveBodies: LeaveRequest[] = [];
    const archiveRequests: string[] = [];
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      if (url.pathname.endsWith('/ledgers') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, options.ledgerList ?? ledgers));
      }
      if (url.pathname.endsWith('/ledgers/ledger-1/leave-preview') && method === 'POST') {
        const body = parseRequestBody(init);
        previewBodies.push(body);
        return Promise.resolve(
          options.previewFactory?.(body) ?? jsonResponse(200, makePreview(options.previewItems)),
        );
      }
      if (url.pathname.endsWith('/ledgers/ledger-1/leave') && method === 'POST') {
        leaveBodies.push(parseRequestBody(init));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith('/ledgers/ledger-1/archive') && method === 'POST') {
        archiveRequests.push(method);
        return Promise.resolve(jsonResponse(200, { id: 'ledger-1' }));
      }
      return Promise.reject(new Error(`未預期的請求：${url.pathname} ${method}`));
    });

    const onCancel = vi.fn();
    const onDeleted = vi.fn();
    const onArchived = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DeleteLedgerDialog
          ledgerId="ledger-1"
          ledgerName="旅行基金"
          ledgerKind={options.kind}
          onCancel={onCancel}
          onDeleted={onDeleted}
          onArchived={onArchived}
        />
      </QueryClientProvider>,
    );
    return { onCancel, onDeleted, onArchived, previewBodies, leaveBodies, archiveRequests };
  }

  async function openNewMove(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '搬到其他帳本 ›' }));
    return screen.findByRole('dialog', { name: '選擇交易' });
  }

  async function addMove(
    user: ReturnType<typeof userEvent.setup>,
    itemTitle: string,
    targetName: string,
  ) {
    await openNewMove(user);
    const row = screen.getByText(itemTitle).closest('label');
    if (!row) throw new Error(`找不到項目列：${itemTitle}`);
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    const target = screen.getByRole('radio', { name: new RegExp(targetName) });
    await user.click(target);
    await user.click(screen.getByRole('button', { name: '完成' }));
  }

  it('starts with moves empty and hides moving when there are no items', async () => {
    const { previewBodies } = renderDialog({ previewItems: [] });

    expect(await screen.findByRole('heading', { name: '刪除「旅行基金」' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '帳戶' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '搬到其他帳本 ›' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '搬移' })).not.toBeInTheDocument();
    await waitFor(() => expect(previewBodies).toHaveLength(1));
    expect(previewBodies[0]).toEqual({ deleteLedger: true, moves: [] });
    expect(previewBodies[0]).not.toHaveProperty('targetLedgerId');
    expect(previewBodies[0]).not.toHaveProperty('excludedItemIds');
  });

  it('shows the server-only account and withdrawal impacts with column hints', async () => {
    renderDialog();

    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '往來' })).toBeInTheDocument();
    expect(screen.getAllByText('現在 → 刪除後')).toHaveLength(2);
    expect(screen.getByText('現金')).toBeInTheDocument();
    expect(screen.getByText('阿德')).toBeInTheDocument();
  });

  it('adds groups, excludes grouped items, disables used ledgers and hides the link when all items move', async () => {
    const user = userEvent.setup();
    const { previewBodies } = renderDialog({ previewItems: items.slice(0, 2) });

    await screen.findByRole('heading', { name: '帳戶' });
    await openNewMove(user);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(
      screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked),
    ).toBe(true);
    const firstItem = screen.getByText('機票訂金').closest('label');
    if (!firstItem) throw new Error('找不到第一筆交易');
    await user.click(within(firstItem).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(screen.getByRole('radio', { name: '日常' })).not.toBeChecked();
    expect(screen.getByText('家用')).toBeInTheDocument();
    expect(screen.queryByText('只讀帳本')).not.toBeInTheDocument();
    expect(screen.queryByText('封存帳本')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '日常' }));
    await user.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(previewBodies.at(-1)).toEqual({
        deleteLedger: true,
        moves: [{ targetLedgerId: 'personal-1', itemIds: ['item-1'] }],
      });
    });
    expect(screen.getByText('機票訂金')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搬到其他帳本 ›' })).toBeInTheDocument();

    await openNewMove(user);
    const secondPicker = screen.getByRole('dialog', { name: '選擇交易' });
    expect(within(secondPicker).queryByText('機票訂金')).not.toBeInTheDocument();
    const secondItem = screen.getByText('存入').closest('label');
    if (!secondItem) throw new Error('找不到第二筆交易');
    await user.click(within(secondItem).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    const usedLedger = screen.getByRole('radio', { name: /日常/ });
    expect(usedLedger).toBeDisabled();
    expect(screen.getByText('已選')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /家用/ }));
    await user.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(previewBodies.at(-1)).toEqual({
        deleteLedger: true,
        moves: [
          { targetLedgerId: 'personal-1', itemIds: ['item-1'] },
          { targetLedgerId: 'shared-1', itemIds: ['item-2'] },
        ],
      });
    });
    expect(screen.queryByRole('button', { name: '搬到其他帳本 ›' })).not.toBeInTheDocument();
  });

  it('edits a group with its items checked and original target selected, then cancels a group', async () => {
    const user = userEvent.setup();
    const { previewBodies } = renderDialog();
    await screen.findByRole('heading', { name: '帳戶' });
    await addMove(user, '機票訂金', '日常');
    await addMove(user, '存入', '家用');

    await user.click(screen.getByRole('button', { name: '修改搬移到 日常' }));
    const itemDialog = screen.getByRole('dialog', { name: '選擇交易' });
    const selectedRow = within(itemDialog).getByText('機票訂金').closest('label');
    if (!selectedRow) throw new Error('找不到已搬移的交易');
    expect(within(selectedRow).getByRole('checkbox')).toBeChecked();
    expect(within(itemDialog).queryByText('存入')).not.toBeInTheDocument();
    const unassignedRow = within(itemDialog).getByText('借給阿德').closest('label');
    if (!unassignedRow) throw new Error('找不到尚未搬移的交易');
    expect(within(unassignedRow).getByRole('checkbox')).not.toBeChecked();
    await user.click(within(selectedRow).getByRole('checkbox'));
    await user.click(within(unassignedRow).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('radio', { name: /日常/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(previewBodies.at(-1)?.moves).toEqual([
        { targetLedgerId: 'personal-1', itemIds: ['item-3'] },
        { targetLedgerId: 'shared-1', itemIds: ['item-2'] },
      ]);
    });
    expect(screen.getByText('借給阿德')).toBeInTheDocument();
    expect(screen.queryByText('機票訂金')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消搬移到 家用' }));
    await waitFor(() => {
      expect(previewBodies.at(-1)?.moves).toEqual([
        { targetLedgerId: 'personal-1', itemIds: ['item-3'] },
      ]);
    });
    await openNewMove(user);
    const remainingPicker = screen.getByRole('dialog', { name: '選擇交易' });
    expect(within(remainingPicker).getByText('存入')).toBeInTheDocument();
    expect(within(remainingPicker).queryByText('借給阿德')).not.toBeInTheDocument();
  });

  it('removes a group when editing and clearing every item', async () => {
    const user = userEvent.setup();
    const { previewBodies } = renderDialog({ previewItems: items.slice(0, 1) });
    await screen.findByRole('heading', { name: '帳戶' });
    await addMove(user, '機票訂金', '日常');
    await user.click(screen.getByRole('button', { name: '修改搬移到 日常' }));
    const selectionDialog = screen.getByRole('dialog', { name: '選擇交易' });
    const row = within(selectionDialog).getByText('機票訂金').closest('label');
    if (!row) throw new Error('找不到已搬移的交易');
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => {
      expect(previewBodies.at(-1)?.moves).toEqual([]);
    });
    expect(screen.queryByRole('heading', { name: '搬移' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搬到其他帳本 ›' })).toBeInTheDocument();
  });

  it('only displays the newest preview after rapid move changes', async () => {
    const user = userEvent.setup();
    let resolveStale: ((response: Response) => void) | undefined;
    let emptyPreviewCount = 0;
    const delayedPreview = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });
    const { previewBodies } = renderDialog({
      previewItems: items.slice(0, 1),
      previewFactory: (request) => {
        if (request.moves?.length) return delayedPreview;
        emptyPreviewCount += 1;
        return jsonResponse(
          200,
          makePreview(items.slice(0, 1), emptyPreviewCount === 1 ? 5000 : 900),
        );
      },
    });
    expect(await screen.findByText('$50')).toBeInTheDocument();

    await addMove(user, '機票訂金', '日常');
    await user.click(screen.getByRole('button', { name: '取消搬移到 日常' }));
    await waitFor(() => expect(previewBodies).toHaveLength(3));
    expect(await screen.findByText('$9')).toBeInTheDocument();
    await act(async () => {
      resolveStale?.(jsonResponse(200, makePreview(items.slice(0, 1), 9900)));
      await delayedPreview;
    });
    expect(screen.getByText('$9')).toBeInTheDocument();
    expect(screen.queryByText('$99')).not.toBeInTheDocument();
  });

  it('archives directly without using the move execution endpoint', async () => {
    const user = userEvent.setup();
    const { onArchived, leaveBodies, archiveRequests } = renderDialog({ previewItems: [] });
    await screen.findByLabelText('輸入帳本名稱');
    await user.click(screen.getByRole('button', { name: '封存' }));

    await waitFor(() => expect(onArchived).toHaveBeenCalledOnce());
    expect(archiveRequests).toEqual(['POST']);
    expect(leaveBodies).toEqual([]);
  });

  it('requires the exact name and sends only deleteLedger, moves and confirm', async () => {
    const user = userEvent.setup();
    const { onDeleted, leaveBodies } = renderDialog({ previewItems: [] });
    await screen.findByRole('heading', { name: '刪除「旅行基金」' });
    const remove = await screen.findByRole('button', { name: '刪除' });
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText('輸入帳本名稱'), '錯誤');
    expect(remove).toBeDisabled();
    await user.clear(screen.getByLabelText('輸入帳本名稱'));
    await user.type(screen.getByLabelText('輸入帳本名稱'), '旅行基金');
    expect(remove).toBeEnabled();
    await user.click(remove);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(leaveBodies).toEqual([{ deleteLedger: true, moves: [], confirm: '旅行基金' }]);
    expect(leaveBodies[0]).not.toHaveProperty('targetLedgerId');
    expect(leaveBodies[0]).not.toHaveProperty('excludedItemIds');
  });

  it('keeps the shared ledger delete branch on the 3k leave dialog', async () => {
    const user = userEvent.setup();
    const { onDeleted, leaveBodies, previewBodies } = renderDialog({ kind: 'SHARED' });
    expect(await screen.findByRole('heading', { name: '刪除「旅行基金」' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /選擇交易/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('輸入帳本名稱'), '旅行基金');
    await user.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(previewBodies.some((body) => body.moves === undefined)).toBe(true);
    expect(leaveBodies[0]).toMatchObject({
      targetLedgerId: 'personal-1',
      excludedItemIds: [],
      deleteLedger: true,
      confirm: '旅行基金',
    });
    expect(leaveBodies[0]).not.toHaveProperty('moves');
  });
});
