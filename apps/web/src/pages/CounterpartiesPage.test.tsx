import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty, LedgerSummary } from '@ledger/shared';
import App from '../App';

describe('CounterpartiesPage', () => {
  const fetchMock = vi.fn();
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const linked: Counterparty = {
    id: 'cp-linked',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    balance: 1_000_000,
    link: { userId: 'user-1', userName: '王小明', theirBalance: -700_000 },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const unlinked: Counterparty = {
    ...linked,
    id: 'cp-unlinked',
    name: '林小安',
    displayName: '林小安',
    link: null,
  };
  let directoryItems: Counterparty[];
  let withLedger: boolean;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/counterparties');
    directoryItems = [linked, unlinked];
    withLedger = true;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      if (url.includes('/ledgers')) {
        return json(withLedger ? [ledger] : []);
      }
      if (url.includes('/friend-requests')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.endsWith('/counterparties') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as unknown;
        const name =
          typeof body === 'object' &&
          body !== null &&
          'name' in body &&
          typeof body.name === 'string'
            ? body.name
            : '';
        const created: Counterparty = {
          ...unlinked,
          id: 'cp-added',
          name,
          displayName: name,
        };
        directoryItems = [...directoryItems, created];
        return json(created);
      }
      if (url.includes('/counterparties/') && url.includes('/entries')) {
        return json({ items: [], page: 1, limit: 20, total: 0 });
      }
      if (url.includes('/counterparties/')) {
        const id = url.split('/counterparties/')[1]?.split('/')[0];
        return json(directoryItems.find((item) => item.id === id) ?? unlinked);
      }
      if (url.includes('/counterparties')) {
        return json({ items: directoryItems, page: 1, limit: 100, total: directoryItems.length });
      }
      return Promise.reject(new Error(`未預期的請求：${url} (${init?.method ?? 'GET'})`));
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('debounces name search before requesting the directory with q', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: '對象' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜尋' }), '王小明');

    await waitFor(() => {
      const requested = fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), window.location.origin);
        return url.pathname.endsWith('/counterparties') && url.searchParams.get('q') === '王小明';
      });
      expect(requested).toBe(true);
    });
  });

  it('opens the selected person in the right panel without showing list balances', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const row = await screen.findByRole('button', { name: /王小明/ });
    expect(container).not.toHaveTextContent('$');
    await user.click(row);

    const workbench = await screen.findByRole('dialog', { name: '借還往來' });
    expect(within(workbench).getByRole('button', { name: '記一筆' })).toBeInTheDocument();
  });

  it('opens and clears the one-time counterparty location state', async () => {
    const initialState = {
      usr: { openCounterpartyId: 'cp-linked' },
      key: 'open-counterparty-once',
      idx: 0,
    };
    window.history.pushState(initialState, '', '/counterparties');
    render(<App />);

    expect(await screen.findByRole('dialog', { name: '借還往來' })).toBeInTheDocument();
    await waitFor(() => {
      const state = (window.history.state as { usr?: Record<string, unknown> }).usr;
      expect(state?.openCounterpartyId).toBeUndefined();
      expect(state?.keepRightPanel).toBe(true);
    });
  });

  it('opens the new person after AddCounterpartyDialog succeeds', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '＋ 新增' }));
    const addDialog = screen.getByRole('dialog', { name: '新增一個人' });
    await user.type(within(addDialog).getByLabelText('名字'), '新對象');
    await user.click(within(addDialog).getByRole('button', { name: '新增' }));

    expect(await screen.findByRole('dialog', { name: '借還往來' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/counterparties') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('keeps the directory visible without mounting a transaction workbench when no ledger exists', async () => {
    withLedger = false;
    render(<App />);

    expect(await screen.findByRole('button', { name: /林小安/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });
});
