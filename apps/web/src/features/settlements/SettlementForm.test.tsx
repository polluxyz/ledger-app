import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { LedgerSummary, LedgerPerson, Transaction } from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettlementForm } from './SettlementForm';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-hua' } }),
}));

/** 結清表單的輸入規則與 request body：使用 hooks 的真實路徑，mock 只取代 HTTP。 */
describe('SettlementForm', () => {
  const fetchMock = vi.fn();
  const requests: { url: string; init?: RequestInit }[] = [];
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '花蓮三日',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: true,
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const hua: LedgerPerson = {
    id: 'person-hua',
    name: '小華',
    userId: 'user-hua',
    status: 'MEMBER',
  };
  const min: LedgerPerson = {
    id: 'person-min',
    name: '小明',
    userId: 'user-min',
    status: 'LEFT',
  };
  const guest: LedgerPerson = {
    id: 'person-guest',
    name: '阿美',
    userId: null,
    status: 'GUEST',
  };
  const account = { id: 'account-hua', name: '現金', initialBalance: 0, balance: 100000 };
  const people = [hua, min, guest];
  const transaction: Transaction = {
    id: 'transaction-id',
    type: 'TRANSFER',
    amount: 205000,
    date: '2026-09-02T00:00:00.000Z',
    title: null,
    note: '旅費',
    category: null,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'user-hua', name: '小華' },
    debt: null,
    split: null,
    payer: null,
    ledgerSplit: null,
    settlement: { id: 'settlement-id', from: hua, to: min },
    accountPending: false,
    createdAt: '2026-09-02T00:00:00.000Z',
  };
  const otherPayerTransaction: Transaction = {
    ...transaction,
    account: null,
    settlement: { id: 'settlement-edit-id', from: min, to: guest },
  };

  function renderForm(props: Partial<ComponentProps<typeof SettlementForm>> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSaved = props.onSaved ?? vi.fn();
    const onDeleted = props.onDeleted ?? vi.fn();
    render(
      <QueryClientProvider client={client}>
        <SettlementForm ledger={ledger} onSaved={onSaved} onDeleted={onDeleted} {...props} />
      </QueryClientProvider>,
    );
    return { onSaved, onDeleted };
  }

  function parseRequestBody(init: RequestInit): unknown {
    if (typeof init.body !== 'string') {
      throw new Error('結清請求缺少 JSON body');
    }
    return JSON.parse(init.body) as unknown;
  }

  function findRequest(path: string, method: string): RequestInit {
    const request = requests.find(({ url, init }) => url.includes(path) && init?.method === method);
    if (!request?.init) {
      throw new Error(`找不到 ${method} ${path} 請求`);
    }
    return request.init;
  }

  function expectDateString(body: unknown) {
    if (typeof body !== 'object' || body === null || !('date' in body)) {
      throw new Error('結清 request body 缺少日期');
    }
    expect(typeof body.date).toBe('string');
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    requests.length = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (String(url).includes('/people')) return json(people);
      if (String(url).endsWith('/accounts')) return json([account]);
      if (String(url).includes('/settlements') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (String(url).includes('/settlements') && init?.method === 'POST') return json(transaction);
      return json(transaction);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefills a suggestion and posts as the current payer without fromPersonId', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm({
      prefill: { fromPersonId: hua.id, toPersonId: min.id, amount: 205000 },
    });

    const from = await screen.findByLabelText('付錢的人');
    const to = screen.getByLabelText('收錢的人');
    await screen.findByRole('option', { name: '現金' });
    expect(from).toHaveValue(hua.id);
    expect(to).toHaveValue(min.id);
    expect(screen.getByLabelText('金額')).toHaveValue(2050);
    expect(screen.getByLabelText('帳戶')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('帳戶'), account.id);
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ url, init }) =>
            url.includes('/ledgers/ledger-1/settlements') && init?.method === 'POST',
        ),
      ).toBe(true);
    });
    const body = parseRequestBody(findRequest('/ledgers/ledger-1/settlements', 'POST'));
    expect(body).toMatchObject({
      toPersonId: min.id,
      amount: 205000,
      fromAccountId: account.id,
    });
    expectDateString(body);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('sends toAccountId when the current user is the receiver', async () => {
    const user = userEvent.setup();
    renderForm({ prefill: { fromPersonId: min.id, toPersonId: hua.id, amount: 100000 } });

    await screen.findByRole('option', { name: '現金' });
    await user.selectOptions(await screen.findByLabelText('帳戶'), account.id);
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ url, init }) =>
            url.includes('/ledgers/ledger-1/settlements') && init?.method === 'POST',
        ),
      ).toBe(true);
    });
    const body = parseRequestBody(findRequest('/ledgers/ledger-1/settlements', 'POST'));
    expect(body).toMatchObject({
      fromPersonId: min.id,
      toPersonId: hua.id,
      amount: 100000,
      toAccountId: account.id,
    });
    expectDateString(body);
  });

  it('patches an edited settlement with the current payer person id and account', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm({ transaction: otherPayerTransaction });

    const from = await screen.findByLabelText('付錢的人');
    await within(from).findByRole('option', { name: '我' });
    await user.selectOptions(from, hua.id);
    await screen.findByRole('option', { name: '現金' });
    await user.selectOptions(await screen.findByLabelText('帳戶'), account.id);
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ url, init }) =>
            url.endsWith('/ledgers/ledger-1/settlements/settlement-edit-id') &&
            init?.method === 'PATCH',
        ),
      ).toBe(true);
    });
    const body = parseRequestBody(
      findRequest('/ledgers/ledger-1/settlements/settlement-edit-id', 'PATCH'),
    );
    expect(body).toMatchObject({
      fromPersonId: hua.id,
      toPersonId: guest.id,
      amount: 205000,
      note: '旅費',
      fromAccountId: account.id,
    });
    expectDateString(body);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('disables add when the same person is selected and offers every person without status labels', async () => {
    const user = userEvent.setup();
    renderForm();

    const from = await screen.findByLabelText('付錢的人');
    const to = screen.getByLabelText('收錢的人');
    await within(from).findByRole('option', { name: '小明' });
    expect(within(from).getByRole('option', { name: '小明' })).toBeInTheDocument();
    expect(within(from).getByRole('option', { name: '阿美' })).toBeInTheDocument();
    expect(screen.queryByText(/已離開|好友/)).not.toBeInTheDocument();

    await user.selectOptions(to, hua.id);
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  it('omits the account field when neither side is the current user', async () => {
    const user = userEvent.setup();
    renderForm();

    const from = await screen.findByLabelText('付錢的人');
    const to = screen.getByLabelText('收錢的人');
    await within(from).findByRole('option', { name: '阿美' });
    await user.selectOptions(from, guest.id);
    await user.selectOptions(to, min.id);

    expect(screen.queryByLabelText('帳戶')).not.toBeInTheDocument();
  });

  it('deletes an edited settlement using settlement.id', async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderForm({ transaction });

    await screen.findByRole('option', { name: '現金' });
    expect(await screen.findByLabelText('帳戶')).toHaveValue(account.id);
    await user.click(screen.getByRole('button', { name: '刪除' }));
    const confirm = await screen.findByRole('dialog', { name: '刪除結清' });
    await user.click(within(confirm).getByRole('button', { name: '刪除' }));

    await waitFor(() => {
      expect(
        requests.some(
          ({ url, init }) =>
            url.endsWith('/ledgers/ledger-1/settlements/settlement-id') &&
            init?.method === 'DELETE',
        ),
      ).toBe(true);
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(
      requests.some(({ url }) => url.endsWith('/ledgers/ledger-1/settlements/transaction-id')),
    ).toBe(false);
  });
});
