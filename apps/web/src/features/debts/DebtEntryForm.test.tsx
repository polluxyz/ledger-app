import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateDebtEntryRequest, LedgerSummary } from '@ledger/shared';
import { DebtEntryForm } from './DebtEntryForm';

/**
 * 驗證三種借還種類、依 API 餘額呈現的還款方向、超額提示與 W16 預覽，並核對送出的 body。
 * fetch mock 回傳伺服器餘額，測試不替後端推導往來紀錄結果。
 */
describe('DebtEntryForm', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const anotherLedger: LedgerSummary = { ...ledger, id: 'ledger-2', name: '另一個帳本' };
  const counterparties = [
    {
      id: 'cp-ming',
      name: '舊小明',
      displayName: '小明',
      askMerge: false,
      balance: 900,
      link: { userId: 'user-ming', userName: '王小明', theirBalance: -900 },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-hua',
      name: '小華',
      displayName: '小華',
      askMerge: false,
      balance: -40000,
      link: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-mei',
      name: '小美',
      displayName: '小美',
      askMerge: false,
      balance: 0,
      link: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const accounts = [
    {
      id: 'acc-cash',
      name: '現金',
      initialBalance: 0,
      balance: 88000,
      isTemporary: false,
      hasTransactions: true,
    },
    {
      id: 'acc-bank',
      name: '銀行',
      initialBalance: 0,
      balance: 500000,
      isTemporary: false,
      hasTransactions: true,
    },
    {
      id: 'acc-temp',
      name: '臨時帳戶',
      initialBalance: 0,
      balance: 0,
      isTemporary: true,
      hasTransactions: false,
    },
  ];
  const categories = [
    { id: 'category-expense', name: '居住', type: 'EXPENSE', icon: null },
    { id: 'category-income', name: '薪資', type: 'INCOME', icon: null },
  ];
  let recordDefaults = { ledgerId: 'ledger-1', accountId: 'acc-cash' };
  let delayedDefaults: Promise<Response> | null = null;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    recordDefaults = { ledgerId: 'ledger-1', accountId: 'acc-cash' };
    delayedDefaults = null;

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
        const rawBody = init?.body;
        const requestJson =
          typeof rawBody === 'string' ? rawBody : (JSON.stringify(rawBody ?? {}) ?? '{}');
        const request = JSON.parse(requestJson) as CreateDebtEntryRequest;
        const counterpartyTarget = request.counterparty;
        const existingCounterparty =
          'id' in counterpartyTarget
            ? counterparties.find((item) => item.id === counterpartyTarget.id)
            : counterparties.find((item) => item.name === counterpartyTarget.name);
        const before = existingCounterparty?.balance ?? 0;
        const balance =
          request.kind === 'LEND'
            ? before + request.amount
            : request.kind === 'BORROW'
              ? before - request.amount
              : request.settle
                ? 0
                : before > 0
                  ? before - request.amount
                  : before + request.amount;
        const responseCounterparty = existingCounterparty
          ? { ...existingCounterparty, balance }
          : counterparties[0];
        return json({ counterparty: responseCounterparty, entries: [] }, 201);
      }
      if (url.includes('/counterparties')) {
        return json({ items: counterparties, page: 1, limit: 100, total: counterparties.length });
      }
      if (url.includes('/accounts')) {
        return json(accounts);
      }
      if (url.includes('/users/me/record-defaults')) {
        return delayedDefaults ?? json(recordDefaults);
      }
      if (url.includes('/categories')) {
        const type = new URL(url).searchParams.get('type');
        return json(type ? categories.filter((category) => category.type === type) : categories);
      }
      if (url.includes('/ledgers')) {
        return json([ledger, anotherLedger]);
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

  it('shows three kinds with an expense category picker and removes paid-for-only fields', () => {
    renderForm();

    const kindGroup = screen.getByRole('group', { name: '往來種類' });
    expect(
      within(kindGroup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['借出', '借入', '還款']);
    expect(screen.queryByRole('button', { name: '對方還我' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我還對方' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '對方幫我付' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '分類' })).toBeInTheDocument();
    expect(screen.queryByLabelText('不記入帳本')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();
    expect(screen.queryByText('目前沒有欠款')).not.toBeInTheDocument();
  });

  it('keeps the new-entry fields in order and places the repayment hint before the amount', async () => {
    const user = userEvent.setup();
    renderForm(ledger, '小明');
    await screen.findByText('目前小明欠你 $9');
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.type(screen.getByLabelText('金額'), '9');
    await user.click(screen.getByRole('checkbox', { name: '以此結清' }));

    const form = screen.getByLabelText('對象').closest('form');
    if (!form) throw new Error('新增借還表單不存在');
    const category = screen.getByRole('combobox', { name: '分類' });
    const date = screen.getByLabelText('日期');
    expect(date.parentElement?.parentElement).toBe(category.parentElement?.parentElement);
    const ordered = [
      screen.getByLabelText('對象'),
      screen.getByRole('group', { name: '往來種類' }),
      screen.getByText('小明還你'),
      screen.getByLabelText('金額'),
      date,
      category,
      screen.getByLabelText('收進哪個帳戶'),
      screen.getByLabelText('名稱'),
      screen.getByLabelText('備註'),
      screen.getByRole('checkbox', { name: '以此結清' }),
      screen.getByText('記完後兩清'),
      within(form).getByRole('button', { name: '新增' }),
    ];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (!current || !next) throw new Error('欄位順序檢查缺少節點');
      expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('lists and clears categories when the debt direction changes', async () => {
    const user = userEvent.setup();
    renderForm(ledger, '小明');
    await screen.findByText('目前小明欠你 $9');

    const picker = screen.getByRole('combobox', { name: '分類' });
    await user.click(picker);
    const expenseList = screen.getByRole('listbox', { name: '分類' });
    expect(within(expenseList).getByRole('option', { name: '居住' })).toBeInTheDocument();
    expect(within(expenseList).queryByRole('option', { name: '薪資' })).not.toBeInTheDocument();
    await user.click(within(expenseList).getByRole('option', { name: '居住' }));

    await user.click(screen.getByRole('button', { name: '借入' }));
    expect(picker).toHaveAttribute('aria-valuetext', '請選擇分類');
    await user.click(picker);
    const incomeList = screen.getByRole('listbox', { name: '分類' });
    expect(within(incomeList).getByRole('option', { name: '薪資' })).toBeInTheDocument();
    expect(within(incomeList).queryByRole('option', { name: '居住' })).not.toBeInTheDocument();
    await user.click(within(incomeList).getByRole('option', { name: '薪資' }));

    await user.click(screen.getByRole('button', { name: '還款' }));
    expect(picker).toHaveAttribute('aria-valuetext', '請選擇分類');
    await user.click(picker);
    const repaymentList = screen.getByRole('listbox', { name: '分類' });
    expect(within(repaymentList).getByRole('option', { name: '薪資' })).toBeInTheDocument();
    expect(within(repaymentList).queryByRole('option', { name: '居住' })).not.toBeInTheDocument();
  });

  it('uses an expense category when repaying a counterparty I owe', async () => {
    const user = userEvent.setup();
    renderForm(ledger, '小華');
    await screen.findByText('目前你欠小華 $400');
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.click(screen.getByRole('combobox', { name: '分類' }));

    const options = screen.getByRole('listbox', { name: '分類' });
    expect(within(options).getByRole('option', { name: '居住' })).toBeInTheDocument();
    expect(within(options).queryByRole('option', { name: '薪資' })).not.toBeInTheDocument();
  });

  it('sends the active ledger, trimmed title, and optional category without a ledger field', async () => {
    const user = userEvent.setup();
    renderForm(anotherLedger, '小明');
    await screen.findByText('目前小明欠你 $9');
    await waitFor(() => expect(screen.getByLabelText('從哪個帳戶借出')).toHaveValue('acc-cash'));
    await user.type(screen.getByLabelText('金額'), '12');
    await user.type(screen.getByLabelText('名稱'), '  押金  ');
    await user.click(screen.getByRole('combobox', { name: '分類' }));
    await user.click(screen.getByRole('option', { name: '居住' }));
    expect(screen.queryByLabelText('記在哪本帳本')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.record).toEqual({ ledgerId: 'ledger-2', accountId: 'acc-cash' });
    expect(body.title).toBe('押金');
    expect(body.categoryId).toBe('category-expense');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('record-defaults?ledgerId=ledger-2'),
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: '小明',
      balanceHint: '目前小明欠你 $9',
      direction: '記完後：小明欠你 $6',
      accountLabel: '收進哪個帳戶',
      accountId: 'acc-cash',
    },
    {
      name: '小華',
      balanceHint: '目前你欠小華 $400',
      direction: '記完後：你欠小華 $397',
      accountLabel: '從哪個帳戶付出',
      accountId: 'acc-bank',
    },
  ])(
    'shows the API repayment direction for $name and posts REPAYMENT',
    async ({ name, balanceHint, direction, accountLabel, accountId }) => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText('對象'), name);
      await screen.findByText(balanceHint);
      await user.click(screen.getByRole('button', { name: '還款' }));
      await user.type(screen.getByLabelText('金額'), '3');
      expect(screen.getByText(direction)).toBeInTheDocument();
      await user.selectOptions(await screen.findByLabelText(accountLabel), accountId);
      await user.click(screen.getByRole('button', { name: '新增' }));

      const body = await postedBody();
      expect(body.counterparty).toEqual({ id: name === '小明' ? 'cp-ming' : 'cp-hua' });
      expect(body.kind).toBe('REPAYMENT');
      expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId });
      expect('settle' in body).toBe(false);
    },
  );

  it('updates repayment direction when the selected counterparty changes', async () => {
    renderForm(ledger, '小明');
    await screen.findByText('目前小明欠你 $9');

    fireEvent.click(screen.getByRole('button', { name: '還款' }));
    fireEvent.change(screen.getByLabelText('對象'), { target: { value: '小華' } });

    expect(await screen.findByText('目前你欠小華 $400')).toBeInTheDocument();
    expect(screen.getByLabelText('從哪個帳戶付出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '還款' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('omits the linked confirmation reminder below the preview', async () => {
    const user = userEvent.setup();
    renderForm();

    const input = screen.getByRole('combobox', { name: '對象' });
    await user.type(input, '小明');
    await user.click(await screen.findByRole('option', { name: /小明.*連動/ }));
    await user.type(screen.getByLabelText('金額'), '4');

    expect(screen.getByText('記完後：小明欠你 $13')).toBeInTheDocument();
    expect(screen.queryByText(/送出後會請/)).not.toBeInTheDocument();
  });

  it('uses parsed cents when previewing the resulting balance', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小明');
    await screen.findByText('目前小明欠你 $9');
    await user.type(screen.getByLabelText('金額'), '0.33');

    expect(screen.getByText('記完後：小明欠你 $9.33')).toBeInTheDocument();
  });

  it('does not show a repayment direction while lend is selected', async () => {
    renderForm(ledger, '小明');
    await screen.findByText('目前小明欠你 $9');

    expect(screen.getByRole('button', { name: '借出' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('記完後：小明欠你 $9')).not.toBeInTheDocument();
    expect(screen.queryByText('目前沒有欠款')).not.toBeInTheDocument();
  });

  it.each([
    { name: '新朋友', hint: '新對象，送出時建立' },
    { name: '小美', hint: '目前和小美兩清' },
  ])('disables repayment without a balance for $name', async ({ name, hint }) => {
    renderForm(ledger, name);

    expect(await screen.findByText(hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();
    expect(screen.getByText('目前沒有欠款')).toBeInTheDocument();
  });

  it('returns to lend when a repayment target changes to a new or settled counterparty', async () => {
    renderForm(ledger, '小明');
    await screen.findByText('目前小明欠你 $9');
    fireEvent.click(screen.getByRole('button', { name: '還款' }));

    fireEvent.change(screen.getByLabelText('對象'), { target: { value: '小新' } });
    fireEvent.blur(screen.getByLabelText('對象'));
    expect(await screen.findByText('新對象，送出時建立')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '借出' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('對象'), { target: { value: '小美' } });
    expect(await screen.findByText('目前和小美兩清')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '借出' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();
  });

  it.each([
    { kind: '借出', name: '小明', amount: '10', expected: '記完後：小明欠你 $19' },
    { kind: '借入', name: '小明', amount: '8', expected: '記完後：小明欠你 $1' },
    { kind: '還款', name: '小明', amount: '4', expected: '記完後：小明欠你 $5' },
    { kind: '還款', name: '小明', amount: '9', expected: '記完後：兩清' },
    {
      kind: '還款',
      name: '小明',
      amount: '8',
      settle: true,
      expected: '記完後兩清',
    },
    {
      kind: '還款',
      name: '小華',
      amount: '405',
      settle: true,
      expected: '記完後兩清',
    },
    { kind: '還款', name: '小明', amount: '9', settle: true, expected: '記完後兩清' },
  ])(
    'previews $kind using the current balance for $name',
    async ({ kind, name, amount, settle, expected }) => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText('對象'), name);
      if (kind === '還款') {
        await screen.findByText(name === '小明' ? '目前小明欠你 $9' : '目前你欠小華 $400');
      }
      await user.click(screen.getByRole('button', { name: kind }));
      await user.type(screen.getByLabelText('金額'), amount);
      if (settle) {
        await user.click(await screen.findByRole('checkbox', { name: '以此結清' }));
      }

      expect(await screen.findByText(expected)).toBeInTheDocument();
    },
  );

  it('blocks an overpayment until it is marked to settle, then posts REPAYMENT with settle', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小明');
    await screen.findByText('目前小明欠你 $9');
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.type(screen.getByLabelText('金額'), '20');
    expect(
      await screen.findByText('超過欠款 $11。要兩清請勾『以此結清』，或把多出的部分記成借入'),
    ).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('收進哪個帳戶'), 'acc-cash');
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: '以此結清' }));
    expect(await screen.findByText('記完後兩清')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.kind).toBe('REPAYMENT');
    expect(body.settle).toBe(true);
  });

  it('names the opposite kind to record when overpaying a debt owed to the counterparty', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小華');
    await screen.findByText('目前你欠小華 $400');
    await user.click(screen.getByRole('button', { name: '還款' }));
    expect(screen.getByLabelText('從哪個帳戶付出')).toBeInTheDocument();
    await user.type(screen.getByLabelText('金額'), '405');

    expect(
      await screen.findByText('超過欠款 $5。要兩清請勾『以此結清』，或把多出的部分記成借出'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  it('posts an existing counterparty id and keeps the person and kind while clearing amount and note', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), ' 小明 ');
    await user.click(screen.getByRole('button', { name: '借入' }));
    await user.type(screen.getByLabelText('金額'), '11');
    await user.selectOptions(await screen.findByLabelText('借到的錢進哪個帳戶'), 'acc-bank');
    await user.type(screen.getByLabelText('備註'), '臨時周轉');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.counterparty).toEqual({ id: 'cp-ming' });
    expect(body.kind).toBe('BORROW');
    expect(body.amount).toBe(1100);
    expect(String(body.date)).toMatch(ISO_DATE);
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-bank' });
    expect(body.note).toBe('臨時周轉');
    await waitFor(() => {
      expect(screen.getByLabelText('金額')).toHaveValue(null);
      expect(screen.getByLabelText('備註')).toHaveValue('');
      expect(screen.getByLabelText('對象')).toHaveValue(' 小明 ');
      expect(screen.getByRole('button', { name: '借入' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('trims a new counterparty name before posting it', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '  小新  ');
    await user.click(await screen.findByRole('option', { name: '＋ 新增「小新」' }));
    await user.type(screen.getByLabelText('金額'), '250');
    await user.selectOptions(await screen.findByLabelText('從哪個帳戶借出'), 'acc-cash');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.counterparty).toEqual({ name: '小新' });
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-cash' });
    expect('note' in body).toBe(false);
  });

  it('defaults the selectable account and excludes temporary accounts', async () => {
    renderForm();

    const accountSelect = await screen.findByLabelText('從哪個帳戶借出');
    await waitFor(() => {
      expect(accountSelect).toHaveValue('acc-cash');
    });
    expect(accountSelect).toBeRequired();
    expect(screen.queryByLabelText('記在哪本帳本')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '臨時帳戶' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('不記入帳本')).not.toBeInTheDocument();
  });

  it('does not overwrite the account choice made before defaults arrive', async () => {
    let resolveDefaults: ((value: Response) => void) | undefined;
    delayedDefaults = new Promise((resolve) => {
      resolveDefaults = resolve;
    });
    const user = userEvent.setup();
    renderForm();

    const accountSelect = await screen.findByLabelText('從哪個帳戶借出');
    await waitFor(() => expect(accountSelect).toBeEnabled());
    await user.selectOptions(accountSelect, 'acc-bank');
    resolveDefaults?.(
      new Response(JSON.stringify({ ledgerId: 'ledger-1', accountId: 'acc-cash' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await waitFor(() => {
      expect(accountSelect).toHaveValue('acc-bank');
    });
  });

  it('ignores a temporary default account while using the selected ledger', async () => {
    recordDefaults = { ledgerId: 'ledger-archived', accountId: 'acc-temp' };
    renderForm();

    await waitFor(() => {
      expect(screen.getByLabelText('從哪個帳戶借出')).toHaveValue('');
    });
  });

  it('sends settle only with REPAYMENT when it is explicitly checked', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小明');
    await screen.findByText('目前小明欠你 $9');
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.type(screen.getByLabelText('金額'), '8');
    await user.selectOptions(await screen.findByLabelText('收進哪個帳戶'), 'acc-cash');
    await user.click(screen.getByRole('checkbox', { name: '以此結清' }));
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await postedBody();
    expect(body.kind).toBe('REPAYMENT');
    expect(body.settle).toBe(true);
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-cash' });
  });

  it('returns to lend after a successful repayment leaves a zero balance', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('對象'), '小明');
    await screen.findByText('目前小明欠你 $9');
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.type(screen.getByLabelText('金額'), '9');
    await user.selectOptions(await screen.findByLabelText('收進哪個帳戶'), 'acc-cash');
    await user.click(screen.getByRole('button', { name: '新增' }));

    expect(await postedBody()).toMatchObject({ kind: 'REPAYMENT', amount: 900 });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '借出' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('金額')).toHaveValue(null);
      expect(screen.getByLabelText('備註')).toHaveValue('');
      expect(screen.getByLabelText('對象')).toHaveValue('小明');
    });
  });
});
