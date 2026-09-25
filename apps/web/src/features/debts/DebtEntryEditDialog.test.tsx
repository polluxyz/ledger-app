import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtEntry } from '@ledger/shared';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';

/** 編輯視窗只送變更欄位；清空備註要明確用 null 表示刪除。 */
describe('DebtEntryEditDialog', () => {
  const fetchMock = vi.fn();
  const entry: DebtEntry = {
    id: 'entry-1',
    counterpartyId: 'cp-1',
    kind: 'LEND',
    delta: 120,
    date: '2026-09-01T00:00:00.000Z',
    note: '原備註',
    transactionId: 'txn-1',
    balanceAfter: 120,
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
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(testEntry: DebtEntry = entry, linkedUserName?: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <DebtEntryEditDialog entry={testEntry} linkedUserName={linkedUserName} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose, ...rendered };
  }

  it('sends only the changed amount', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });

    const amount = within(dialog).getByLabelText('金額');
    expect(amount).toHaveValue(120);
    await user.clear(amount);
    await user.type(amount, '250');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/debt-entries/entry-1');
    expect(options.method).toBe('PATCH');
    expect(parseRequestBody(options)).toEqual({ amount: 250 });
  });

  it('sends null when the note is cleared', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });

    const note = within(dialog).getByLabelText('備註（選填）');
    await user.clear(note);
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(parseRequestBody(options)).toEqual({ note: null });
  });

  it('shows the neutral sync explanation only for a paired entry', async () => {
    const pairedEntry = { ...entry, paired: true };
    const pairedRender = renderDialog(pairedEntry, '王小明');
    const dialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(dialog).toHaveTextContent(
      '這筆已和王小明同步。存檔後會把新的金額與日期送給他確認；他不接受的話，他那邊維持原樣。備註不會同步。',
    );

    pairedRender.unmount();
    renderDialog(entry, '王小明');
    const unpairedDialog = await screen.findByRole('dialog', { name: '修改往來紀錄' });
    expect(unpairedDialog).not.toHaveTextContent('這筆已和王小明同步');
  });
});
