import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddCounterpartyMemberDialog } from './AddCounterpartyMemberDialog';

describe('AddCounterpartyMemberDialog', () => {
  const fetchMock = vi.fn();
  const members = [
    { userId: 'me', email: 'me@example.com', name: '我', role: 'OWNER' as const },
    {
      userId: 'member-user',
      email: 'member@example.com',
      name: '既有成員',
      role: 'EDITOR' as const,
    },
  ];
  const memberPerson = {
    id: 'person-member',
    name: '既有成員',
    userId: 'member-user',
    status: 'MEMBER',
  };
  const pointedPerson = {
    id: 'person-pointed',
    name: '帳本裡的人',
    userId: null,
    status: 'GUEST',
  };
  const candidates = [
    counterparty('member-linked', '既有對象', { userId: 'member-user' }),
    counterparty('pointed-unlinked', '已指向對象', null),
    counterparty('available-linked', '連動對象', { userId: 'other-user' }),
    counterparty('available-unlinked', '未連動對象', null),
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/ledger-groups')) {
        return Promise.resolve(
          jsonResponse(200, [
            {
              ledger: { id: 'ledger-1', name: '花蓮三日', left: false },
              people: [
                {
                  person: memberPerson,
                  amount: 0,
                  pointer: { counterpartyId: null, auto: true },
                },
                {
                  person: pointedPerson,
                  amount: 0,
                  pointer: { counterpartyId: 'pointed-unlinked', auto: true },
                },
              ],
            },
          ]),
        );
      }
      if (target.includes('/counterparties')) {
        return Promise.resolve(
          jsonResponse(200, { items: candidates, page: 1, limit: 100, total: candidates.length }),
        );
      }
      if (target.endsWith('/ledgers/ledger-1/people') && init?.method === 'POST') {
        // body 先收斂成字串再解析：fetch 的型別允許非字串，直接 String() 會
        // 掉進 [object Object]， ESLint 的 no-base-to-string 也會擋。
        const requestBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
          name?: string;
        };
        return Promise.resolve(
          jsonResponse(201, {
            id: 'created-person',
            name: requestBody.name,
            userId: null,
            status: 'GUEST',
          }),
        );
      }
      if (target.endsWith('/ledgers/ledger-1/members') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, {
            userId: 'new-user',
            email: 'hidden@example.com',
            name: '連動對象',
            role: 'EDITOR',
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog(onClose = vi.fn(), onAddByEmail = vi.fn()) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return {
      onClose,
      onAddByEmail,
      ...render(
        <QueryClientProvider client={client}>
          <AddCounterpartyMemberDialog
            ledgerId="ledger-1"
            ledgerName="花蓮三日"
            members={members}
            onClose={onClose}
            onAddByEmail={onAddByEmail}
          />
        </QueryClientProvider>,
      ),
    };
  }

  it('searches my counterparties, excludes existing members and pointers, and offers email last', async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: '新增對象' });
    expect(await within(dialog).findByRole('button', { name: '連動對象' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '未連動對象' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '既有對象' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '已指向對象' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '用 email 新增' })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('搜尋對象'), '連動');
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('q=%E9%80%A3%E5%8B%95')),
      ).toBe(true);
    });
  });

  it('hands the final email row back to the existing member dialog flow', async () => {
    const onClose = vi.fn();
    const onAddByEmail = vi.fn();
    const user = userEvent.setup();
    renderDialog(onClose, onAddByEmail);

    await user.click(await screen.findByRole('button', { name: '用 email 新增' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onAddByEmail).toHaveBeenCalledOnce();
  });

  it('asks before inviting a linked counterparty and sends the add-name request', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole('button', { name: '連動對象' }));
    const dialog = screen.getByRole('dialog', { name: '新增對象' });
    expect(
      within(dialog).getByText('是否將連動對象邀請至「花蓮三日」共享帳本？'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '只加名字' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '邀請' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '只加名字' }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url], index) =>
          String(url).endsWith('/ledgers/ledger-1/people') &&
          (fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(request).toBeDefined();
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        name: '連動對象',
        counterpartyId: 'available-linked',
      });
    });
  });

  it('invites a linked counterparty as an editor with the counterparty request body', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole('button', { name: '連動對象' }));
    const dialog = screen.getByRole('dialog', { name: '新增對象' });
    await user.click(within(dialog).getByRole('button', { name: '邀請' }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url], index) =>
          String(url).endsWith('/ledgers/ledger-1/members') &&
          (fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(request).toBeDefined();
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        counterpartyId: 'available-linked',
        role: 'EDITOR',
      });
    });
  });

  it('adds an unlinked counterparty directly and displays the backend duplicate-name message', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/ledgers/ledger-1/people') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(409, {
            statusCode: 409,
            errorCode: 'LEDGER_PERSON_NAME_TAKEN',
            message: 'The backend says this name is already taken.',
          }),
        );
      }
      if (String(url).endsWith('/ledger-groups')) {
        return Promise.resolve(
          jsonResponse(200, [
            {
              ledger: { id: 'ledger-1', name: '花蓮三日', left: false },
              people: [
                {
                  person: pointedPerson,
                  amount: 0,
                  pointer: { counterpartyId: 'pointed-unlinked', auto: true },
                },
              ],
            },
          ]),
        );
      }
      if (String(url).includes('/counterparties')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [counterparty('available-unlinked', '未連動對象', null)],
            page: 1,
            limit: 100,
            total: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    });
    const user = userEvent.setup();
    renderDialog();

    const candidate = await screen.findByRole('button', { name: '未連動對象' });
    await user.click(candidate);

    const dialog = screen.getByRole('dialog', { name: '新增對象' });
    // 409 的 LEDGER_PERSON_NAME_TAKEN 由 FormError 換成在地化訊息（error-messages.ts）。
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('這個名字已經有人用了。');
    const request = fetchMock.mock.calls.find(
      ([url], index) =>
        String(url).endsWith('/ledgers/ledger-1/people') &&
        (fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(request).toBeDefined();
    expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
      name: '未連動對象',
      counterpartyId: 'available-unlinked',
    });
  });
});

function counterparty(
  id: string,
  displayName: string,
  link: { userId: string; userName?: string; theirBalance?: number } | null,
) {
  return {
    id,
    name: displayName,
    displayName,
    balance: 0,
    ledgerParts: [],
    totalBalance: 0,
    link:
      link === null
        ? null
        : {
            userId: link.userId,
            userName: link.userName ?? displayName,
            theirBalance: link.theirBalance ?? 0,
          },
    needsMergePrompt: false,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
