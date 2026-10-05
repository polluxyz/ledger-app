import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillAccountForm } from './FillAccountForm';

/** 補帳戶表單只選自己的帳戶；viewer role 不會封鎖專用補帳戶端點。 */
describe('FillAccountForm', () => {
  const fetchMock = vi.fn();
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '家庭帳本',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: true,
    archivedAt: null,
    role: 'VIEWER',
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const account = { id: 'account-1', name: '現金', initialBalance: 0, balance: 100000 };
  const transaction = {
    id: 'transaction-id',
    type: 'EXPENSE',
    amount: 100000,
    date: '2026-10-01T00:00:00.000Z',
    title: null,
    note: null,
    category: null,
    account: null,
    toAccount: null,
    creator: { id: 'user-1', name: 'Alice' },
    debt: null,
    split: null,
    payer: null,
    ledgerSplit: null,
    settlement: null,
    accountPending: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  } as Transaction;

  function renderForm(value = transaction, onSaved = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FillAccountForm ledger={ledger} transaction={value} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    return onSaved;
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (String(url).endsWith('/accounts')) return json([account]);
      if (String(url).includes('/account') && init?.method === 'PUT') return json(transaction);
      return json([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets a viewer assign their own account with only the account selector and save button', async () => {
    const user = userEvent.setup();
    const onSaved = renderForm();

    const accountSelect = await screen.findByLabelText('帳戶');
    await screen.findByRole('option', { name: '現金' });
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();

    await user.selectOptions(accountSelect, account.id);
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/ledgers/ledger-1/transactions/transaction-id/account') &&
            (init as RequestInit | undefined)?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/ledgers/ledger-1/transactions/transaction-id/account') &&
        (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      accountId: account.id,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('uses the settlement id for the settlement account endpoint', async () => {
    const user = userEvent.setup();
    const settlement = {
      ...transaction,
      settlement: {
        id: 'settlement-id',
        from: { id: 'person-1', name: 'Alice', userId: 'user-1', status: 'MEMBER' },
        to: { id: 'person-2', name: 'Bob', userId: 'user-2', status: 'MEMBER' },
      },
    } as Transaction;
    const onSaved = renderForm(settlement);

    await screen.findByRole('option', { name: '現金' });
    await user.selectOptions(await screen.findByLabelText('帳戶'), account.id);
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/ledgers/ledger-1/settlements/settlement-id/account') &&
            (init as RequestInit | undefined)?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/ledgers/ledger-1/settlements/settlement-id/account') &&
        (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      accountId: account.id,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
