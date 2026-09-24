import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt, LedgerSummary } from '@ledger/shared';
import { DebtPaymentDialog } from './DebtPaymentDialog';

/**
 * 記還款彈窗的驗證重點（spec §4.3、Observable acceptance）：
 *
 * 1. 送出的 body 等於 `toPaymentRequest` 的結果（含 record、amount、date 等）。
 * 2. 失敗時不關閉彈窗並由 FormError 顯示錯誤。
 */
describe('DebtPaymentDialog', () => {
  const fetchMock = vi.fn();

  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const debt: Debt = {
    id: 'debt-1',
    direction: 'LENT',
    counterpartyName: '小明',
    principal: 5000,
    date: '2026-09-01T00:00:00.000Z',
    note: null,
    outstanding: 3000,
    status: 'OPEN',
    settlementDifference: null,
    transactionId: 'txn-1',
    payments: [],
    forgivenAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const accounts = [
    { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 },
    { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 5000 },
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/accounts')) {
        return json(accounts);
      }
      return json(debt);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog(props: Partial<Parameters<typeof DebtPaymentDialog>[0]> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DebtPaymentDialog debt={debt} ledger={ledger} open={true} onClose={onClose} {...props} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('submits payment with body matching toPaymentRequest', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    // 預設金額為未清餘額 3000
    expect(await screen.findByLabelText('金額')).toHaveValue(3000);
    // 等帳戶選項載入完畢
    await screen.findByRole('option', { name: '現金' });
    // 選擇收款帳戶
    await user.selectOptions(screen.getByLabelText('收款帳戶'), 'acc-1');

    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/debts/debt-1/payments') &&
          (init as RequestInit)?.method === 'POST',
      );
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
      expect(body.amount).toBe(3000);
      expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-1' });
      expect('settles' in body).toBe(false);
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('keeps dialog open and displays error on failure', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/debts/debt-1/payments') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ errorCode: 'DEBT_OVERPAYMENT', message: '超額' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(
          new Response(JSON.stringify(accounts), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(debt), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('option', { name: '現金' });
    await user.selectOptions(screen.getByLabelText('收款帳戶'), 'acc-1');
    await user.click(screen.getByRole('button', { name: '新增' }));

    // 失敗時不關閉彈窗
    expect(onClose).not.toHaveBeenCalled();
    // 顯示錯誤訊息（FormError 會把 DEBT_OVERPAYMENT 轉成中文）
    expect(await screen.findByText(/金額超過未清餘額/)).toBeInTheDocument();
  });
});
