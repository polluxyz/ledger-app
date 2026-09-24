import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary } from '@ledger/shared';
import { DebtEntryForm } from './DebtEntryForm';

/**
 * 借還表單驗欄位切換、W16 預覽與送往來 API 的 body；fetch mock 讓每個情境都能
 * 直接核對送出內容，特別確認 `record` 的 null 與物件形狀不會混淆。
 */
describe('DebtEntryForm', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

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
  const plainLedger: LedgerSummary = { ...ledger, id: 'ledger-plain', tracksBalance: false };
  const counterparties = [
    {
      id: 'cp-ming',
      name: '小明',
      balance: 93,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-hua',
      name: '阿華',
      balance: -93,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-mei',
      name: '小美',
      balance: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const accounts = [
    { id: 'acc-cash', name: '現金', initialBalance: 0, balance: 880 },
    { id: 'acc-bank', name: '銀行', initialBalance: 0, balance: 5000 },
  ];
  const categories = [{ id: 'cat-food', name: '餐飲', type: 'EXPENSE' }];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      if (url.includes('/debt-entries') && method === 'POST') {
        return json({ counterparty: counterparties[0], entries: [] }, 201);
      }
      if (url.includes('/counterparties')) {
        return json({ items: counterparties, page: 1, limit: 100, total: counterparties.length });
      }
      if (url.includes('/categories')) {
        return json(categories);
      }
      if (url.includes('/accounts')) {
        return json(accounts);
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderForm(selectedLedger = ledger, initialCounterpartyName?: string) {
    render(
      <QueryClientProvider client={queryClient}>
        <DebtEntryForm ledger={selectedLedger} initialCounterpartyName={initialCounterpartyName} />
      </QueryClientProvider>,
    );
  }

  async function postedBody(): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/debt-entries') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it('shows five kinds with kind-specific fields and leaves the account unselected', async () => {
    const user = userEvent.setup();
    renderForm();

    const account = await screen.findByLabelText('從哪個帳戶借出');
    expect(account).toHaveValue('');
    expect(account.firstElementChild).toHaveTextContent('請選擇');
    expect(screen.getByRole('button', { name: '借出' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('分類')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '以此結清' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '借入' }));
    expect(screen.getByLabelText('借到的錢進哪個帳戶')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '對方還我' }));
    expect(screen.getByLabelText('收進哪個帳戶')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '以此結清' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '我還對方' }));
    expect(screen.getByLabelText('從哪個帳戶付出')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '對方幫我付' }));
    expect(screen.queryByLabelText(/帳戶/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '不記入帳本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '以此結清' })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('分類')).toBeInTheDocument();
  });

  it.each([
    { kind: '借出', name: '小明', amount: '10', expected: '記完後：小明欠你 $103' },
    { kind: '借入', name: '小明', amount: '90', expected: '記完後：小明欠你 $3' },
    { kind: '對方還我', name: '小明', amount: '104', expected: '記完後：你欠小明 $11' },
    { kind: '對方還我', name: '小明', amount: '93', expected: '記完後：兩清' },
    {
      kind: '對方還我',
      name: '小明',
      amount: '90',
      settle: true,
      expected: '記完後兩清，差額 −3（少收 3 元）',
    },
    {
      kind: '我還對方',
      name: '阿華',
      amount: '100',
      settle: true,
      expected: '記完後兩清，差額 −7（多付 7 元）',
    },
    {
      kind: '對方還我',
      name: '小明',
      amount: '93',
      settle: true,
      expected: '記完後兩清',
    },
  ])(
    'previews $kind with the matching current balance',
    async ({ kind, name, amount, settle, expected }) => {
      const user = userEvent.setup();
      renderForm();

      await screen.findByLabelText('金額');
      await user.click(screen.getByRole('button', { name: kind }));
      await user.type(screen.getByLabelText('對象'), name);
      await user.type(screen.getByLabelText('金額'), amount);
      if (settle) {
        await user.click(await screen.findByRole('checkbox', { name: '以此結清' }));
      }

      expect(await screen.findByText(expected)).toBeInTheDocument();
    },
  );

  it('posts an existing counterparty id, then keeps the person and kind while clearing amount and note', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), ' 小明 ');
    await user.click(screen.getByRole('button', { name: '借入' }));
    await user.type(screen.getByLabelText('金額'), '111');
    await user.selectOptions(await screen.findByLabelText('借到的錢進哪個帳戶'), 'acc-bank');
    await user.type(screen.getByLabelText('備註（選填）'), '臨時周轉');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.counterparty).toEqual({ id: 'cp-ming' });
    expect(body.kind).toBe('BORROW');
    expect(body.amount).toBe(111);
    expect(String(body.date)).toMatch(ISO_DATE);
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-bank' });
    expect(body.note).toBe('臨時周轉');
    await waitFor(() => {
      expect(screen.getByLabelText('金額')).toHaveValue(null);
      expect(screen.getByLabelText('備註（選填）')).toHaveValue('');
      expect(screen.getByLabelText('對象')).toHaveValue(' 小明 ');
      expect(screen.getByRole('button', { name: '借入' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('trims a new counterparty name before posting it', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '  小新  ');
    await user.type(screen.getByLabelText('金額'), '250');
    await user.selectOptions(await screen.findByLabelText('從哪個帳戶借出'), 'acc-cash');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.counterparty).toEqual({ name: '小新' });
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-cash' });
    expect('note' in body).toBe(false);
  });

  it('posts record null when the user chooses not to record a ledger transaction', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小明');
    await user.type(screen.getByLabelText('金額'), '80');
    await user.click(screen.getByRole('checkbox', { name: '不記入帳本' }));
    expect(screen.getByLabelText('從哪個帳戶借出')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.record).toBeNull();
  });

  it('records a paid-for-me expense with the ledger and expense category but no account', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '對方幫我付' }));
    await user.type(screen.getByLabelText('對象'), '小明');
    await user.type(screen.getByLabelText('金額'), '400');
    await user.selectOptions(await screen.findByLabelText('分類'), 'cat-food');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.kind).toBe('PAID_FOR_ME');
    expect(body.record).toEqual({ ledgerId: 'ledger-1' });
    expect(body.categoryId).toBe('cat-food');
    expect('accountId' in (body.record as object)).toBe(false);
  });

  it('does not send an account id for a non-balance-tracking ledger', async () => {
    const user = userEvent.setup();
    renderForm(plainLedger);

    await user.type(screen.getByLabelText('對象'), '小明');
    await user.type(screen.getByLabelText('金額'), '65');
    expect(screen.queryByLabelText(/帳戶/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.record).toEqual({ ledgerId: 'ledger-plain' });
    expect('accountId' in (body.record as object)).toBe(false);
  });

  it('sends settle only when the repayment is explicitly marked to settle', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '對方還我' }));
    await user.type(screen.getByLabelText('對象'), '小明');
    await user.type(screen.getByLabelText('金額'), '90');
    await user.selectOptions(await screen.findByLabelText('收進哪個帳戶'), 'acc-cash');
    await user.click(screen.getByRole('checkbox', { name: '以此結清' }));
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.settle).toBe(true);
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-cash' });
  });
});
