import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt, LedgerSummary } from '@ledger/shared';
import {
  canSubmitPayment,
  emptyPaymentDraft,
  PaymentFields,
  toPaymentRequest,
  type PaymentDraft,
} from './PaymentFields';

/**
 * 還款欄位的驗證重點（spec §4.1「以此結清」與帳戶規則）：
 *
 * 1. 結清勾選框在金額**少於／等於／多於**未清餘額時的顯示邏輯，以及勾了之後
 *    LENT／BORROWED 各兩種差額預覽文字——這段預覽是全前端唯一允許的相減，
 *    文字與符號寫錯會直接誤導使用者，必須逐字釘住。
 * 2. 帳戶欄**不預選**（第一格是「請選擇」）：預設值會把還款悄悄記錯帳戶。
 * 3. `toPaymentRequest`／`canSubmitPayment` 的 body 規則（plan §2.4）：record
 *    一定要給（物件或 null）、`settles` 只在勾選框有顯示且勾了才送。
 *
 * 策略：`PaymentFields` 是受控元件，用一個帶 state 的 TestHost 包住它；fetch
 * 換成 mock 只為了 `useAccounts` 的選項。純函式（`toPaymentRequest`、
 * `canSubmitPayment`）不需要渲染，直接斷言。
 */

const trackingLedger: LedgerSummary = {
  id: 'ledger-1',
  name: '我的帳本',
  currency: 'TWD',
  kind: 'PERSONAL',
  tracksBalance: true,
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-09-01T00:00:00.000Z',
};
const plainLedger: LedgerSummary = { ...trackingLedger, id: 'ledger-2', tracksBalance: false };

const accounts = [
  { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 },
  { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 5000 },
];

/** 未清餘額 3,000 的債務；`direction` 與 `outstanding` 由測試覆寫。 */
function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
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
    ...overrides,
  };
}

const fetchMock = vi.fn();

/** 受控元件需要呼叫端持有草稿——測試裡由這個 host 代勩。 */
function TestHost({
  debt,
  ledger,
  initial,
}: {
  debt: Debt;
  ledger: LedgerSummary;
  initial: PaymentDraft;
}) {
  const [draft, setDraft] = useState(initial);
  return <PaymentFields debt={debt} ledger={ledger} value={draft} onChange={setDraft} />;
}

function renderFields(options: { debt?: Debt; ledger?: LedgerSummary; initial: PaymentDraft }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TestHost
        debt={options.debt ?? makeDebt()}
        ledger={options.ledger ?? trackingLedger}
        initial={options.initial}
      />
    </QueryClientProvider>,
  );
}

/** 依金額與勾選狀態組草稿，其余沿用 `emptyPaymentDraft` 的預設。 */
function draftOf(debt: Debt, overrides: Partial<PaymentDraft> = {}): PaymentDraft {
  return { ...emptyPaymentDraft(debt), ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(accounts), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settle checkbox visibility by amount', () => {
  it('hides the checkbox when the amount equals the outstanding balance', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt, { amount: '3000' }) });

    // 剛好還清本來就會結清，勾選框與預覽都不該出現。
    expect(screen.queryByRole('checkbox', { name: '以此結清' })).not.toBeInTheDocument();
    expect(screen.queryByText(/差額/)).not.toBeInTheDocument();
    // 等帳戶選項載入，確定後面的斷言不是因為整棵樹還沒渲染。
    expect(await screen.findByLabelText('收款帳戶')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '以此結清' })).not.toBeInTheDocument();
  });

  it('shows the checkbox unchecked when the amount is less than outstanding', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt, { amount: '2000' }) });

    const settle = await screen.findByRole('checkbox', { name: '以此結清' });
    expect(settle).not.toBeChecked();
    // 少於未清餘額是正常的部分還款，不該出現超額提示。
    expect(screen.queryByText('超過未清餘額，要以此結清才能送出')).not.toBeInTheDocument();
  });

  it('shows the checkbox and the overpayment hint when the amount is more', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt, { amount: '4000' }) });

    expect(await screen.findByRole('checkbox', { name: '以此結清' })).not.toBeChecked();
    expect(screen.getByText('超過未清餘額，要以此結清才能送出')).toBeInTheDocument();
  });
});

describe('settlement preview text', () => {
  it('previews a LENT debt paid less than outstanding', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt, { amount: '2000', settles: true }) });

    expect(
      await screen.findByText('差額 -1,000：對方少還 1,000 元，這筆借還會結清'),
    ).toBeInTheDocument();
  });

  it('previews a LENT debt paid more than outstanding', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt, { amount: '3200', settles: true }) });

    expect(
      await screen.findByText('差額 +200：對方多給 200 元，這筆借還會結清'),
    ).toBeInTheDocument();
  });

  it('previews a BORROWED debt paid less than outstanding', async () => {
    const debt = makeDebt({ direction: 'BORROWED' });
    renderFields({ debt, initial: draftOf(debt, { amount: '2000', settles: true }) });

    // 借入少付對我有利，符號從擁有者的角度看是正——與 API 的 settlementDifference 同號。
    expect(
      await screen.findByText('差額 +1,000：我少付 1,000 元，這筆借還會結清'),
    ).toBeInTheDocument();
  });

  it('previews a BORROWED debt paid more than outstanding', async () => {
    const debt = makeDebt({ direction: 'BORROWED' });
    renderFields({ debt, initial: draftOf(debt, { amount: '3200', settles: true }) });

    expect(await screen.findByText('差額 -200：我多付 200 元，這筆借還會結清')).toBeInTheDocument();
  });
});

describe('account field', () => {
  it('starts unselected with a placeholder for a LENT debt', async () => {
    const debt = makeDebt();
    renderFields({ debt, initial: draftOf(debt) });

    const account = await screen.findByLabelText('收款帳戶');
    expect(account).toHaveValue('');
    // 第一個選項是「請選擇」，不是任何帳戶。
    expect(account.querySelector('option')?.textContent).toBe('請選擇');
  });

  it('labels the field 付款帳戶 for a BORROWED debt', async () => {
    const debt = makeDebt({ direction: 'BORROWED' });
    renderFields({ debt, initial: draftOf(debt) });

    expect(await screen.findByLabelText('付款帳戶')).toHaveValue('');
    expect(screen.queryByLabelText('收款帳戶')).not.toBeInTheDocument();
  });

  it('disables the account field and explains when unrecorded is checked', async () => {
    const debt = makeDebt();
    const user = userEvent.setup();
    renderFields({ debt, initial: draftOf(debt) });

    await user.click(await screen.findByRole('checkbox', { name: '不記入帳本' }));

    expect(screen.getByLabelText('收款帳戶')).toBeDisabled();
    expect(screen.getByText('帳戶餘額不會變動')).toBeInTheDocument();
  });

  it('omits the account field entirely for a non-tracking ledger', () => {
    const debt = makeDebt();
    renderFields({ debt, ledger: plainLedger, initial: draftOf(debt) });

    expect(screen.queryByLabelText('收款帳戶')).not.toBeInTheDocument();
    expect(
      screen.getByText('這本帳本不影響你的帳戶餘額，因此不需要選擇帳戶。'),
    ).toBeInTheDocument();
  });
});

describe('toPaymentRequest', () => {
  it('sends record: null when unrecorded is checked', () => {
    const debt = makeDebt();
    const request = toPaymentRequest(
      draftOf(debt, { amount: '3000', unrecorded: true, accountId: 'acc-1' }),
      debt,
      trackingLedger,
    );

    expect(request.record).toBeNull();
  });

  it('sends the ledger and the chosen account normally', () => {
    const debt = makeDebt();
    const request = toPaymentRequest(
      draftOf(debt, { amount: '3000', accountId: 'acc-2' }),
      debt,
      trackingLedger,
    );

    expect(request.record).toEqual({ ledgerId: 'ledger-1', accountId: 'acc-2' });
    expect(request.amount).toBe(3000);
    expect(request.note).toBeUndefined();
  });

  it('sends record without accountId for a non-tracking ledger', () => {
    const debt = makeDebt();
    const request = toPaymentRequest(
      draftOf(debt, { amount: '3000', accountId: '' }),
      debt,
      plainLedger,
    );

    // 非連動帳本帶了 accountId 會被後端 400 ACCOUNT_NOT_ALLOWED 擋下。
    expect(request.record).toEqual({ ledgerId: 'ledger-2' });
  });

  it('sends settles: true only when the checkbox is visible and checked', () => {
    const debt = makeDebt();
    // 金額多於未清餘額 → 勾選框有顯示，勾了要送 settles: true。
    const checked = toPaymentRequest(
      draftOf(debt, { amount: '4000', settles: true }),
      debt,
      trackingLedger,
    );
    expect(checked.settles).toBe(true);

    // 勾選框有顯示但沒勾 → 不帶。
    const unchecked = toPaymentRequest(draftOf(debt, { amount: '2000' }), debt, trackingLedger);
    expect(unchecked.settles).toBeUndefined();

    // 金額等於未清餘額 → 勾選框根本沒顯示，即使殘留勾選狀態也不送。
    const invisible = toPaymentRequest(
      draftOf(debt, { amount: '3000', settles: true }),
      debt,
      trackingLedger,
    );
    expect(invisible.settles).toBeUndefined();
  });

  it('converts the date to ISO and keeps a non-empty note', () => {
    const debt = makeDebt();
    const request = toPaymentRequest(
      draftOf(debt, { amount: '3000', date: '2026-09-24', note: '第一期' }),
      debt,
      trackingLedger,
    );

    expect(request.date).toBe(new Date('2026-09-24').toISOString());
    expect(request.note).toBe('第一期');
  });
});

describe('canSubmitPayment', () => {
  const debt = makeDebt();

  it('rejects a blank or non-positive amount', () => {
    expect(
      canSubmitPayment(draftOf(debt, { amount: '', accountId: 'acc-1' }), debt, trackingLedger),
    ).toBe(false);
    expect(
      canSubmitPayment(draftOf(debt, { amount: '0', accountId: 'acc-1' }), debt, trackingLedger),
    ).toBe(false);
  });

  it('rejects a tracking ledger without an account', () => {
    expect(canSubmitPayment(draftOf(debt, { amount: '100' }), debt, trackingLedger)).toBe(false);
    // 勾了不記入帳本就不需要帳戶。
    expect(
      canSubmitPayment(draftOf(debt, { amount: '100', unrecorded: true }), debt, trackingLedger),
    ).toBe(true);
  });

  it('rejects an overpayment without settling', () => {
    expect(
      canSubmitPayment(draftOf(debt, { amount: '4000', accountId: 'acc-1' }), debt, trackingLedger),
    ).toBe(false);
    expect(
      canSubmitPayment(
        draftOf(debt, { amount: '4000', accountId: 'acc-1', settles: true }),
        debt,
        trackingLedger,
      ),
    ).toBe(true);
  });

  it('accepts a normal partial payment and needs no account on a plain ledger', () => {
    expect(
      canSubmitPayment(draftOf(debt, { amount: '1000', accountId: 'acc-1' }), debt, trackingLedger),
    ).toBe(true);
    expect(canSubmitPayment(draftOf(debt, { amount: '1000' }), debt, plainLedger)).toBe(true);
  });
});
