import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtProposal, FriendRequest } from '@ledger/shared';
import App from '../../App';

/**
 * 待確認卡片驗證邀請與提議的句型、展開操作及送出的 API body。
 *
 * 策略：從真實 App 掛載頁面與 query providers，只替換 fetch；這樣測試同時能確認
 * 卡片透過既有 hook 讀資料，並讓 mutation 的路徑、方法與 body 都經過 api client。
 */
describe('PendingCard', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const account = {
    id: 'account-1',
    name: '現金',
    initialBalance: 0,
    balance: 500,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const counterparty = {
    id: 'counterparty-1',
    name: '小明',
    balance: 100,
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  let invites: FriendRequest[] = [];
  let proposals: DebtProposal[] = [];
  let proposalTotal = 0;
  let failNextProposalAccept: string | null = null;

  const response = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  function inputUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
      return input;
    }
    return input instanceof URL ? input.href : input.url;
  }

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    invites = [];
    proposals = [];
    proposalTotal = 0;
    failNextProposalAccept = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = inputUrl(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url.includes('/friend-requests/') && url.endsWith('/accept')) {
        const requestId = url.match(/friend-requests\/([^/]+)\/accept/)?.[1];
        const accepted = invites.find((request) => request.id === requestId) ?? invite();
        invites = invites.filter((request) => request.id !== requestId);
        return response({ ...accepted, status: 'ACCEPTED' });
      }
      if (method === 'POST' && url.includes('/friend-requests/') && url.endsWith('/decline')) {
        const requestId = url.match(/friend-requests\/([^/]+)\/decline/)?.[1];
        const declined = invites.find((request) => request.id === requestId) ?? invite();
        invites = invites.filter((request) => request.id !== requestId);
        return response({ ...declined, status: 'DECLINED' });
      }
      if (method === 'POST' && url.includes('/debt-proposals/') && url.endsWith('/accept')) {
        if (failNextProposalAccept !== null) {
          const errorCode = failNextProposalAccept;
          failNextProposalAccept = null;
          return response({ statusCode: 409, errorCode, message: 'Conflict' }, 409);
        }
        const proposalId = url.match(/debt-proposals\/([^/]+)\/accept/)?.[1];
        const accepted = proposals.find((item) => item.id === proposalId) ?? proposal();
        proposals = proposals.filter((item) => item.id !== proposalId);
        proposalTotal = proposals.length;
        return response({ ...accepted, status: 'ACCEPTED' });
      }
      if (method === 'POST' && url.includes('/debt-proposals/') && url.endsWith('/decline')) {
        const proposalId = url.match(/debt-proposals\/([^/]+)\/decline/)?.[1];
        const declined = proposals.find((item) => item.id === proposalId) ?? proposal();
        proposals = proposals.filter((item) => item.id !== proposalId);
        proposalTotal = proposals.length;
        return response({ ...declined, status: 'DECLINED' });
      }

      if (url.includes('/friend-requests?')) {
        return response({ items: invites, page: 1, limit: 20, total: invites.length });
      }
      if (url.includes('/debt-proposals?')) {
        return response({ items: proposals, page: 1, limit: 20, total: proposalTotal });
      }
      if (url.includes('/counterparties?')) {
        const query = new URL(url).searchParams;
        const found =
          query.get('limit') === '100'
            ? { ...counterparty, name: query.get('q') ?? counterparty.name }
            : counterparty;
        return response({ items: [found], page: 1, limit: 50, total: 1 });
      }
      if (url.includes('/counterparties/')) {
        return response(counterparty);
      }
      if (url.includes('/transactions')) {
        return response({ items: [], page: 1, limit: 5, total: 0 });
      }
      if (url.includes('/accounts')) {
        return response([account]);
      }
      if (url.includes('/ledgers')) {
        return response([ledger]);
      }
      if (url.includes('/categories')) {
        return response([]);
      }
      return response([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  function signIn() {
    localStorage.setItem('ledger.accessToken', 'jwt-test');
  }

  function invite(overrides: Partial<FriendRequest> = {}): FriendRequest {
    return {
      id: 'invite-1',
      direction: 'incoming',
      status: 'PENDING',
      counterpart: { userId: 'user-2', name: '王小明', email: null },
      forLink: true,
      counterpartyId: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      respondedAt: null,
      ...overrides,
    };
  }

  function proposal(overrides: Partial<DebtProposal> = {}): DebtProposal {
    return {
      id: 'proposal-1',
      direction: 'incoming',
      type: 'CREATE',
      status: 'PENDING',
      otherUser: { id: 'user-2', name: '王小明' },
      counterpartyId: 'counterparty-1',
      entryKind: 'BORROW',
      amount: 200,
      date: '2026-09-25T00:00:00.000Z',
      settle: false,
      previous: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      respondedAt: null,
      ...overrides,
    };
  }

  async function renderHome() {
    signIn();
    render(<App />);
    // 先等作用中帳本載入，避免點到「尚無帳本」暫態畫面裡即將卸載的卡片。
    await screen.findByRole('button', { name: '新增交易' }, WAIT);
  }

  function postedBody(pathPart: string): unknown {
    const call = fetchMock.mock.calls.find(
      ([url, init]) => inputUrl(url).includes(pathPart) && (init?.method ?? 'GET') === 'POST',
    );
    expect(call).toBeDefined();
    const body = call?.[1]?.body;
    expect(typeof body).toBe('string');
    return JSON.parse(body as string);
  }

  it('renders each required invitation and proposal sentence', async () => {
    invites = [invite()];
    proposals = [
      proposal({ id: 'lend', entryKind: 'LEND' }),
      proposal({ id: 'borrow', entryKind: 'BORROW' }),
      proposal({ id: 'collect', entryKind: 'COLLECT', amount: 50, settle: true }),
      proposal({ id: 'repay', entryKind: 'REPAY', amount: 80 }),
      proposal({ id: 'forgiven', entryKind: 'FORGIVEN' }),
      proposal({
        id: 'amend',
        type: 'AMEND',
        entryKind: 'BORROW',
        amount: 150,
        date: '2026-09-22T00:00:00.000Z',
        previous: { amount: 120, date: '2026-09-20T00:00:00.000Z' },
      }),
      proposal({
        id: 'amend-null',
        type: 'AMEND',
        entryKind: 'BORROW',
        amount: 150,
        date: '2026-09-22T00:00:00.000Z',
        previous: null,
      }),
      proposal({
        id: 'delete',
        type: 'DELETE',
        entryKind: 'BORROW',
        amount: 120,
        date: '2026-09-20T00:00:00.000Z',
      }),
    ];
    proposalTotal = proposals.length;
    await renderHome();

    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: '顯示全部' }));

    expect(card).toHaveTextContent('王小明 邀請你連動往來帳');
    expect(card).toHaveTextContent('王小明 記了一筆：你借給他 $200 · 09/25');
    expect(card).toHaveTextContent('王小明 記了一筆：你向他借入 $200 · 09/25');
    expect(card).toHaveTextContent('王小明 記了一筆：他還你 $50 · 09/25，並以此結清');
    expect(card).toHaveTextContent('王小明 記了一筆：你還他 $80 · 09/25');
    expect(card).toHaveTextContent('王小明 免除了你欠他的錢');
    expect(card).toHaveTextContent('王小明 把 09/20 的借入 $120 → $150 · 09/20 → 09/22');
    expect(card).toHaveTextContent('王小明 把一筆借入改成 $150 · 09/22');
    expect(card).toHaveTextContent('王小明 刪了 09/20 的借入 $120');
  });

  it('does not render when there are no pending items', async () => {
    await renderHome();

    await screen.findAllByText('即將推出', undefined, WAIT);
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: '待確認' })).not.toBeInTheDocument();
    }, WAIT);
  });

  it('keeps only one proposal expanded at a time', async () => {
    proposals = [
      proposal({ id: 'proposal-1' }),
      proposal({ id: 'proposal-2', otherUser: { id: 'user-3', name: '陳小華' } }),
    ];
    proposalTotal = 2;
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getAllByRole('button', { name: '接受' })[0]!);
    expect(within(card).getByLabelText('記在哪本帳本')).toBeInTheDocument();

    await user.click(within(card).getAllByRole('button', { name: '接受' })[0]!);
    expect(within(card).getByLabelText('記在哪本帳本')).toBeInTheDocument();
    expect(within(card).getByLabelText('借到的錢進哪個帳戶')).toBeInTheDocument();
  });

  it('accepts a link invite using the prefilled name and then offers the ledger link', async () => {
    invites = [invite()];
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));
    await user.click(within(card).getByRole('button', { name: '接受並連動' }));

    await waitFor(() => {
      expect(postedBody('/friend-requests/invite-1/accept')).toEqual({
        counterparty: { name: '王小明' },
      });
    }, WAIT);
    expect(await within(card).findByText('已連動。', undefined, WAIT)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '查看往來帳' })).toBeInTheDocument();
  });

  it('accepts a link invite with the selected counterparty id', async () => {
    invites = [invite()];
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));
    const picker = within(card).getByLabelText('對方在你的往來帳裡是誰？');
    await user.click(picker);
    await user.click(await within(card).findByRole('option', { name: '小明' }, WAIT));
    await user.click(within(card).getByRole('button', { name: '接受並連動' }));

    await waitFor(() => {
      expect(postedBody('/friend-requests/invite-1/accept')).toEqual({
        counterparty: { id: 'counterparty-1' },
      });
    }, WAIT);
    expect(await within(card).findByText('已連動。', undefined, WAIT)).toBeInTheDocument();
  });

  it('requires an account for a balance-tracking ledger and sends the selected target', async () => {
    proposals = [proposal({ entryKind: 'BORROW' })];
    proposalTotal = 1;
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));
    const acceptButton = within(card).getByRole('button', { name: '接受' });
    expect(acceptButton).toBeDisabled();
    await user.selectOptions(within(card).getByLabelText('借到的錢進哪個帳戶'), 'account-1');
    expect(acceptButton).toBeEnabled();
    await user.click(acceptButton);

    await waitFor(() => {
      expect(postedBody('/debt-proposals/proposal-1/accept')).toEqual({
        record: { ledgerId: 'ledger-1', accountId: 'account-1' },
      });
    }, WAIT);
  });

  it('sends record null when the proposal is accepted without a ledger entry', async () => {
    proposals = [proposal({ entryKind: 'BORROW' })];
    proposalTotal = 1;
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));
    await user.click(within(card).getByRole('checkbox', { name: '不記入帳本（只記往來）' }));
    expect(within(card).getByLabelText('記在哪本帳本')).toBeDisabled();
    expect(within(card).getByLabelText('借到的錢進哪個帳戶')).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: '接受' }));

    await waitFor(() => {
      expect(postedBody('/debt-proposals/proposal-1/accept')).toEqual({ record: null });
    }, WAIT);
  });

  it('accepts an amend proposal directly with an empty body', async () => {
    proposals = [
      proposal({
        type: 'AMEND',
        previous: { amount: 120, date: '2026-09-20T00:00:00.000Z' },
      }),
    ];
    proposalTotal = 1;
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));

    await waitFor(() => {
      expect(postedBody('/debt-proposals/proposal-1/accept')).toEqual({});
    }, WAIT);
  });

  it('changes the repayment conflict action to decline and calls decline without a dialog', async () => {
    proposals = [proposal({ entryKind: 'REPAY', amount: 80 })];
    proposalTotal = 1;
    failNextProposalAccept = 'REPAYMENT_EXCEEDS_BALANCE';
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '接受' }));
    await user.selectOptions(within(card).getByLabelText('從哪個帳戶付出'), 'account-1');
    await user.click(within(card).getByRole('button', { name: '接受' }));

    expect(
      await within(card).findByText(
        '這筆還款超過你帳上的欠款。你可以拒絕，再和王小明對一下帳。',
        undefined,
        WAIT,
      ),
    ).toBeInTheDocument();
    const declineButton = within(card).getByRole('button', { name: '改成拒絕' });
    await user.click(declineButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/debt-proposals/proposal-1/decline'),
        expect.objectContaining({ method: 'POST' }),
      );
    }, WAIT);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('declines directly without asking for confirmation', async () => {
    proposals = [proposal({ type: 'AMEND' })];
    proposalTotal = 1;
    await renderHome();
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: '待確認' }, WAIT);

    await user.click(within(card).getByRole('button', { name: '拒絕' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/debt-proposals/proposal-1/decline'),
        expect.objectContaining({ method: 'POST' }),
      );
    }, WAIT);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
