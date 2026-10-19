import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtEntry } from '@ledger/shared';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';

/** 編輯視窗只送變更欄位；清空備註要明確用 null 表示刪除。 */
describe('DebtEntryEditDialog', () => {
  const fetchMock = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>();
  const entry: DebtEntry = {
    id: 'entry-1',
    counterpartyId: 'cp-1',
    kind: 'LEND',
    delta: 12000,
    date: '2026-09-01T00:00:00.000Z',
    note: '原備註',
    transactionId: 'txn-1',
    recorded: {
      ledgerId: 'ledger-1',
      accountId: 'account-1',
      title: '押金',
      categoryId: 'category-1',
      categoryIcon: 'food',
    },
    splitId: null,
    settlesEntryId: null,
    difference: null,
    merge: null,
    balanceAfter: 12000,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  function parseRequestBody(options: RequestInit): unknown {
    if (typeof options.body !== 'string') {
      throw new Error('往來修改請求缺少 JSON body');
    }
    return JSON.parse(options.body) as unknown;
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      const body = url.includes('/accounts')
        ? [
            { id: 'account-1', name: '現金', isTemporary: false },
            { id: 'account-2', name: '銀行', isTemporary: false },
          ]
        : url.includes('/categories')
          ? [{ id: 'category-1', name: '居住', type: 'EXPENSE', icon: null }]
          : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(testEntry: DebtEntry = entry, displayName = '王小明') {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <DebtEntryEditDialog entry={testEntry} displayName={displayName} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose, ...rendered };
  }

  async function patchedRequest(): Promise<[string, RequestInit]> {
    let call: [string, RequestInit] | undefined;
    await waitFor(() => {
      const found = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(found).toBeDefined();
      call = found as [string, RequestInit] | undefined;
    });
    if (!call) throw new Error('找不到往來修改請求');
    return call;
  }

  it('orders and prefills all six fields, including the recorded category and account', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    const amount = within(dialog).getByLabelText('金額');
    const date = within(dialog).getByLabelText('日期');
    const category = within(dialog).getByRole('combobox', { name: '分類' });
    const account = within(dialog).getByLabelText('帳戶');
    const title = within(dialog).getByLabelText('名稱');
    const note = within(dialog).getByLabelText('備註');

    expect(amount).toHaveValue(120);
    expect(date).toHaveValue('2026-09-01');
    await waitFor(() => {
      expect(category).toHaveAttribute('aria-valuetext', '居住');
      expect(account).toHaveValue('account-1');
    });
    expect(title).toHaveValue('押金');
    expect(note).toHaveValue('原備註');
    const ordered = [amount, date, category, account, title, note];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (!current || !next) throw new Error('欄位順序檢查缺少節點');
      expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(date.parentElement?.parentElement).toBe(category.parentElement?.parentElement);
  });

  it('sends only the changed amount', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });

    const amount = within(dialog).getByLabelText('金額');
    expect(amount).toHaveValue(120);
    await user.clear(amount);
    await user.type(amount, '250');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const [url, options] = await patchedRequest();
    expect(url).toContain('/debt-entries/entry-1');
    expect(options.method).toBe('PATCH');
    expect(parseRequestBody(options)).toEqual({ amount: 25000 });
  });

  it('prefills and submits the received amount for a repayment with a difference', async () => {
    const user = userEvent.setup();
    const settledRepayment: DebtEntry = {
      ...entry,
      kind: 'COLLECT',
      delta: -9300,
      difference: { transactionId: 'difference-1', type: 'EXPENSE', amount: 300 },
    };
    renderDialog(settledRepayment);
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });

    const amount = within(dialog).getByLabelText('金額');
    expect(amount).toHaveValue(90);
    await user.clear(amount);
    await user.type(amount, '95');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const [, options] = await patchedRequest();
    expect(parseRequestBody(options)).toEqual({ amount: 9500 });
  });

  it('sends null when the note is cleared', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });

    const note = within(dialog).getByLabelText('備註');
    await user.clear(note);
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const [, options] = await patchedRequest();
    expect(parseRequestBody(options)).toEqual({ note: null });
  });

  it('sends nulls for cleared title and category with the changed account and note', async () => {
    const user = userEvent.setup();
    renderDialog({ ...entry, paired: true }, '小明');
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    await user.clear(within(dialog).getByLabelText('名稱'));
    await user.selectOptions(within(dialog).getByLabelText('帳戶'), 'account-2');
    await user.click(within(dialog).getByRole('combobox', { name: '分類' }));
    await user.click(within(dialog).getByRole('option', { name: '不選' }));
    await user.clear(within(dialog).getByLabelText('備註'));

    expect(dialog).not.toHaveTextContent('會送給小明確認');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const [, options] = await patchedRequest();
    expect(parseRequestBody(options)).toEqual({
      accountId: 'account-2',
      title: null,
      categoryId: null,
      note: null,
    });
  });

  it('hides account, category, and title for a legacy entry without a recorded transaction', async () => {
    renderDialog({ ...entry, recorded: null });
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(within(dialog).queryByLabelText('帳戶')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('名稱')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: '分類' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('金額')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('日期')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('備註')).toBeInTheDocument();
  });

  it('hides account, category, and title for a legacy paid-for-me entry, which has no account', async () => {
    renderDialog({
      ...entry,
      kind: 'PAID_FOR_ME',
      delta: -12000,
      recorded: {
        ledgerId: 'ledger-1',
        accountId: null,
        title: null,
        categoryId: null,
        categoryIcon: null,
      },
    });
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(within(dialog).queryByLabelText('帳戶')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('名稱')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: '分類' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('金額')).toBeInTheDocument();
  });

  it('shows the confirmation line only after the amount or date changes', async () => {
    const user = userEvent.setup();
    const pairedEntry = { ...entry, paired: true };
    const pairedRender = renderDialog(pairedEntry, '小明的暱稱');
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(dialog).not.toHaveTextContent('會送給小明的暱稱確認');
    await user.clear(within(dialog).getByLabelText('名稱'));
    await user.type(within(dialog).getByLabelText('名稱'), '新名稱');
    await user.selectOptions(within(dialog).getByLabelText('帳戶'), 'account-2');
    expect(dialog).not.toHaveTextContent('會送給小明的暱稱確認');
    await user.clear(within(dialog).getByLabelText('金額'));
    await user.type(within(dialog).getByLabelText('金額'), '125');
    expect(dialog).toHaveTextContent('會送給小明的暱稱確認');
    expect(dialog).not.toHaveTextContent('他不接受的話');
    expect(dialog).not.toHaveTextContent('備註不會同步');

    pairedRender.unmount();
    renderDialog(entry, '小明的暱稱');
    const unpairedDialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(unpairedDialog).not.toHaveTextContent('會送給小明的暱稱確認');
    await user.clear(within(unpairedDialog).getByLabelText('日期'));
    await user.type(within(unpairedDialog).getByLabelText('日期'), '2026-09-02');
    expect(unpairedDialog).not.toHaveTextContent('會送給小明的暱稱確認');
  });
});
