import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerLeaveItem, LedgerLeavePreview } from '@ledger/shared';
import { LeaveLedgerDialog } from './LeaveLedgerDialog';
import styles from './LeaveItemPicker.module.css';

const sourceLedger = {
  id: 'source',
  name: '花蓮三日',
  kind: 'SHARED',
  currency: 'TWD',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'OWNER',
};
const editableSharedLedger = {
  ...sourceLedger,
  id: 'shared-target',
  name: '家用',
  role: 'EDITOR',
};
const viewerLedger = { ...editableSharedLedger, id: 'viewer-ledger', name: '唯讀', role: 'VIEWER' };
const firstPersonalLedger = {
  ...sourceLedger,
  id: 'personal-first',
  name: '日常',
  kind: 'PERSONAL',
  role: 'OWNER',
};
const secondPersonalLedger = { ...firstPersonalLedger, id: 'personal-second', name: '旅行' };
const archivedLedger = {
  ...firstPersonalLedger,
  id: 'archived-ledger',
  name: '已封存',
  archivedAt: '2026-09-01T00:00:00.000Z',
};

const items: LedgerLeaveItem[] = [
  {
    id: 'item-1',
    date: '2026-10-01T12:00:00.000Z',
    title: '住宿',
    categoryIcon: 'home',
    accountEffects: [{ accountId: 'account-1', name: '信用卡', delta: -300000 }],
    share: 100000,
    paidByName: null,
    kind: 'SHARED',
  },
  {
    id: 'item-2',
    date: '2026-10-02T12:00:00.000Z',
    title: '晚餐',
    categoryIcon: 'food',
    accountEffects: [],
    share: 50000,
    paidByName: '小華',
    kind: 'SHARED',
  },
];

function preview(overrides: Partial<LedgerLeavePreview> = {}): LedgerLeavePreview {
  return {
    items: [...items],
    accounts: [
      { accountId: 'account-1', name: '信用卡', balance: -1240000, balanceAfter: -940000 },
    ],
    carryOvers: [
      {
        ledgerPersonId: 'person-hua',
        displayName: '小華',
        amount: 50000,
        counterpartyId: 'cp-hua',
      },
    ],
    withdrawals: [],
    leave: { allowed: true, blockedBy: null },
    ...overrides,
  };
}

describe('LeaveLedgerDialog', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let requestBodies: Array<{ path: string; method: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    requestBodies = [];
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function readBody(init?: RequestInit) {
    return typeof init?.body === 'string'
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : undefined;
  }

  function setup(
    options: {
      makePreview?: (body: Record<string, unknown>) => Promise<Response> | Response;
      onLeave?: () => Promise<Response> | Response;
    } = {},
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = new URL(String(url));
      const method = init?.method ?? 'GET';
      const body = readBody(init);
      requestBodies.push({ path: target.pathname, method, body });
      if (target.pathname.endsWith('/ledgers') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, [
            sourceLedger,
            editableSharedLedger,
            viewerLedger,
            archivedLedger,
            firstPersonalLedger,
            secondPersonalLedger,
          ]),
        );
      }
      if (target.pathname.endsWith('/leave-preview') && method === 'POST') {
        return Promise.resolve(options.makePreview?.(body ?? {}) ?? jsonResponse(200, preview()));
      }
      if (target.pathname.endsWith('/leave') && method === 'POST') {
        return Promise.resolve(options.onLeave?.() ?? new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`未預期的請求：${target.pathname}`));
    });
    const onCancel = vi.fn();
    const onCompleted = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <LeaveLedgerDialog
          ledgerId="source"
          ledgerName="花蓮三日"
          onCancel={onCancel}
          onCompleted={onCompleted}
        />
      </QueryClientProvider>,
    );
    return { onCancel, onCompleted };
  }

  it('defaults to the first writable personal ledger, shows only changed accounts and carry-over arrows, then submits the leave body', async () => {
    const user = userEvent.setup();
    const { onCompleted } = setup();

    expect(await screen.findByRole('heading', { name: '退出「花蓮三日」' })).toBeInTheDocument();
    const target = await screen.findByRole('combobox', { name: '合併到' });
    expect(target).toHaveValue('personal-first');
    expect(
      requestBodies.find((request) => request.path.endsWith('/leave-preview'))?.body,
    ).toMatchObject({ targetLedgerId: 'personal-first', excludedItemIds: [] });
    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    const accountRow = screen.getByText('信用卡').closest('li');
    expect(accountRow).not.toBeNull();
    expect(within(accountRow as HTMLElement).getByText('-$12,400')).toHaveClass(
      styles.balanceBefore!,
    );
    expect(within(accountRow as HTMLElement).getByText('-$9,400')).toHaveClass(
      styles.balanceAfterIncome!,
    );
    expect(screen.queryByText('未變動的現金')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '往來' })).toBeInTheDocument();
    expect(screen.getByText('小華')).toBeInTheDocument();
    expect(screen.getByLabelText('小華 → 我')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出' }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    const leaveRequest = requestBodies.find((request) => request.path.endsWith('/leave'));
    expect(leaveRequest).toMatchObject({
      method: 'POST',
      body: { targetLedgerId: 'personal-first', excludedItemIds: [] },
    });
  });

  it('offers only cancel when the server says leaving is blocked', async () => {
    setup({
      makePreview: () =>
        jsonResponse(
          200,
          preview({ leave: { allowed: false, blockedBy: 'LAST_OWNER' }, accounts: [] }),
        ),
    });

    expect(await screen.findByText('你是最後一位擁有者，不能退出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
  });

  it('sends each sorted exclusion, keeps the latest rapid-toggle preview, and returns with that preview', async () => {
    const user = userEvent.setup();
    let resolveFirst: (() => void) | undefined;
    let resolveLatest: (() => void) | undefined;
    setup({
      makePreview: (body) => {
        const excluded = body.excludedItemIds as string[];
        if (excluded.length === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = () =>
              resolve(
                jsonResponse(
                  200,
                  preview({
                    accounts: [
                      {
                        accountId: 'account-1',
                        name: '信用卡',
                        balance: -1240000,
                        balanceAfter: -900000,
                      },
                    ],
                  }),
                ),
              );
          });
        }
        if (excluded.length === 2) {
          return new Promise<Response>((resolve) => {
            resolveLatest = () =>
              resolve(
                jsonResponse(
                  200,
                  preview({
                    accounts: [
                      {
                        accountId: 'account-1',
                        name: '信用卡',
                        balance: -1240000,
                        balanceAfter: -500000,
                      },
                    ],
                  }),
                ),
              );
          });
        }
        return jsonResponse(200, preview());
      },
    });

    await user.click(await screen.findByRole('button', { name: /選擇交易/ }));
    expect(await screen.findByText('小華付')).toBeInTheDocument();
    const checks = screen.getAllByRole('checkbox');
    expect(checks.slice(1)).toHaveLength(2);
    expect(checks.slice(1).every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);

    await user.click(checks[1]!);
    await user.click(checks[2]!);
    await waitFor(() => {
      expect(resolveFirst).toBeTypeOf('function');
      expect(resolveLatest).toBeTypeOf('function');
    });
    expect(
      requestBodies
        .filter((request) => request.path.endsWith('/leave-preview'))
        .map((request) => request.body?.excludedItemIds),
    ).toContainEqual(['item-1', 'item-2']);

    resolveLatest?.();
    await waitFor(() => {
      const latestPreview = queryClient
        .getQueryCache()
        .getAll()
        .find(
          (query) =>
            query.queryKey[0] === 'ledger-leave-preview' &&
            query.queryKey[2] === null &&
            JSON.stringify(query.queryKey[3]) === JSON.stringify(['item-1', 'item-2']),
        );
      expect(
        (latestPreview?.state.data as LedgerLeavePreview | undefined)?.accounts[0]?.balanceAfter,
      ).toBe(-500000);
    });
    expect(document.body.textContent).toContain('-$12,400→-$5,000');
    resolveFirst?.();
    await waitFor(() => {
      expect(screen.queryByText('-$9,000')).not.toBeInTheDocument();
      expect(screen.getAllByText('-$5,000').length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.getByRole('button', { name: '選擇交易（已勾 0／2）›' })).toBeInTheDocument();
    expect(screen.getAllByText('-$5,000').length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: '合併到' })).not.toBeInTheDocument();
  });
});
