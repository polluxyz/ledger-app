import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt } from '@ledger/shared';
import { DebtEditDialog } from './DebtEditDialog';

/**
 * 編輯債務彈窗的驗證重點（spec §4.3、Observable acceptance）：
 *
 * 1. 有結清還款時沒有本金欄，並提示說明文字。
 * 2. PATCH 只送有變動的欄位。
 * 3. 清空備註時送 `null`。
 */
describe('DebtEditDialog', () => {
  const fetchMock = vi.fn();

  const openDebt: Debt = {
    id: 'debt-1',
    direction: 'LENT',
    counterpartyName: '小明',
    principal: 5000,
    date: '2026-09-01T00:00:00.000Z',
    note: '原本備註',
    outstanding: 3000,
    status: 'OPEN',
    settlementDifference: null,
    transactionId: 'txn-1',
    payments: [],
    forgivenAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const debtWithSettledPayment: Debt = {
    ...openDebt,
    id: 'debt-settled',
    payments: [
      {
        id: 'pmt-1',
        amount: 2900,
        date: '2026-09-02T00:00:00.000Z',
        note: null,
        transactionId: 'txn-2',
        settles: true,
        createdAt: '2026-09-02T00:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(openDebt), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog(debt: Debt = openDebt) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DebtEditDialog debt={debt} open={true} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('hides the principal field and shows notice when there is a settled payment', () => {
    renderDialog(debtWithSettledPayment);

    expect(screen.queryByLabelText('本金')).not.toBeInTheDocument();
    expect(screen.getByText('先刪除結清的還款才能改本金')).toBeInTheDocument();
    expect(screen.getByLabelText('對方名字')).toBeInTheDocument();
  });

  it('sends only changed fields on submit', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(openDebt);

    // 只改對方名字
    const nameInput = screen.getByLabelText('對方名字');
    await user.clear(nameInput);
    await user.type(nameInput, '小華');

    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/debts/debt-1') && (init as RequestInit)?.method === 'PATCH',
      );
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
      expect(body).toEqual({ counterpartyName: '小華' });
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('sends note as null when note is cleared', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(openDebt);

    // 清空原本的備註
    const noteInput = screen.getByLabelText('備註（選填）');
    await user.clear(noteInput);

    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/debts/debt-1') && (init as RequestInit)?.method === 'PATCH',
      );
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
      expect(body).toEqual({ note: null });
    });

    expect(onClose).toHaveBeenCalled();
  });
});
