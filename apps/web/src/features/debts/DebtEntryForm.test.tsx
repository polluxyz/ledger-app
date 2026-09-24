import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 「借還」分頁的新增表單（spec 3b-1 §4.1）：借出／借入／還款三種模式送出的
 * **body 形狀**。
 *
 * body 是這一檔的重點（plan §2.4）：借出／借入沒勾舊債要帶 `record`、勾了就
 * 整個不帶；還款則**一律明確給** `record`——省略時後端會沿用本金交易的帳本與
 * 帳戶，畫面上顯示的與實際記進去的可能不同。差一個鍵不會拋錯，只會記錯帳，
 * 所以逐鍵斷言。
 *
 * 策略：從真實的 `App` 出發（借還分頁住在右側欄的新增表單裡），只把 `fetch`
 * 換成 mock，比照 `use-transactions.test.tsx`。
 */
describe('Debt entry form', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const accounts = [
    { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 },
    { id: 'acc-2', name: 'LINE Pay', initialBalance: 0, balance: 120 },
  ];
  /** 未結清：借給小明 5,000，已還 2,000，未清 3,000。 */
  const openDebt = {
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

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function routeFetch() {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/debts/summary')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [{ counterpartyName: '小明', counterpartyUserId: null, net: 5000 }],
          }),
        );
      }
      if (url.includes('/debts/debt-1/payments') && method === 'POST') {
        return Promise.resolve(jsonResponse(200, openDebt));
      }
      if (url.includes('/debts') && method === 'POST') {
        return Promise.resolve(jsonResponse(201, openDebt));
      }
      if (url.includes('/debts')) {
        return Promise.resolve(
          jsonResponse(200, { items: [openDebt], page: 1, limit: 100, total: 1 }),
        );
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [category]));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, accounts));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });
  }

  const WAIT = { timeout: 5000 };
  /** 日期由表單預設今天再轉 ISO，比對形狀即可（比照 transaction-edit 逐欄比對的寫法）。 */
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  /** 打開右側欄的新增表單、切到「借還」分頁，回傳借還分頁的根。 */
  async function openDebtTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '新增交易' }, WAIT));
    await user.click(await screen.findByRole('button', { name: '借還' }, WAIT));
    return await screen.findByRole('button', { name: '借出' }, WAIT);
  }

  /** 找出某個 URL 前綴與方法的請求 body（最後一次）。 */
  async function sentBody(
    urlPart: string,
    method: 'POST' | 'PATCH',
  ): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(urlPart) && (init as RequestInit | undefined)?.method === method,
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  it('creates a LENT debt with an explicit record', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await openDebtTab(user);

    await user.type(screen.getByLabelText('對方名字'), '小明');
    await user.type(screen.getByLabelText('金額'), '5000');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await sentBody('/debts', 'POST');
    // 逐欄比對（含「哪些鍵不該出現」），比一次 toEqual 整包更能指出問題在哪。
    expect(body.direction).toBe('LENT');
    expect(body.counterpartyName).toBe('小明');
    expect(body.principal).toBe(5000);
    expect(String(body.date)).toMatch(ISO_DATE);
    // 沒勾舊債：記進作用中帳本，帳戶照慣例落在第一個（現金）；備註空就不帶。
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-1' });
    expect('note' in body).toBe(false);
  });

  it('omits record entirely when the old-debt checkbox is checked', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await openDebtTab(user);

    await user.type(screen.getByLabelText('對方名字'), '小明');
    await user.type(screen.getByLabelText('金額'), '5000');
    await user.click(screen.getByRole('checkbox', { name: '這是舊債，不記入帳本' }));
    // 勾了舊債，帳戶欄停用並說明餘額不會動。
    expect(screen.getByLabelText('帳戶')).toBeDisabled();
    expect(screen.getByText('帳戶餘額不會變動')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await sentBody('/debts', 'POST');
    // SC-W5：舊債的 body **沒有 record 這個鍵**（省略＝不產生交易，決策 7）。
    expect(body.direction).toBe('LENT');
    expect(body.counterpartyName).toBe('小明');
    expect(body.principal).toBe(5000);
    expect(String(body.date)).toMatch(ISO_DATE);
    expect('record' in body).toBe(false);
  });

  it('prefills the payment amount with the outstanding balance of the picked debt', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await openDebtTab(user);
    await user.click(screen.getByRole('button', { name: '還款' }));

    const debtSelect = await screen.findByLabelText('債務', {}, WAIT);
    // 下拉的每一項寫出方向、對方與未清餘額（spec §4.1），數字取自 API。
    expect(debtSelect).toHaveTextContent('借給小明 · 剩 $3,000');
    await user.selectOptions(debtSelect, 'debt-1');

    // 金額預設為那筆債務的未清餘額；帳戶不預選（收款／付款管道常與借出時不同）。
    // type="number" 的值由 jest-dom 以數字比對。
    expect(await screen.findByLabelText('金額', {}, WAIT)).toHaveValue(3000);
    expect(screen.getByLabelText('收款帳戶')).toHaveValue('');
  });

  it('creates a payment with an explicit record and no settles when paying exactly', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await openDebtTab(user);
    await user.click(screen.getByRole('button', { name: '還款' }));
    await user.selectOptions(await screen.findByLabelText('債務', {}, WAIT), 'debt-1');
    // 還款的帳戶每次自己選——這裡刻意選第二個，證明不是沿用預設。
    await user.selectOptions(screen.getByLabelText('收款帳戶'), 'acc-2');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const body = await sentBody('/debts/debt-1/payments', 'POST');
    expect(body.amount).toBe(3000);
    expect(String(body.date)).toMatch(ISO_DATE);
    // 還款一律明確帶 record（plan §2.4），不依賴後端「沿用本金交易」的預設。
    expect(body.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-2' });
    // 金額剛好等於未清餘額：勾選框沒顯示，settles 不該出現在 body；備註空就不帶。
    expect('settles' in body).toBe(false);
    expect('note' in body).toBe(false);
  });
});
