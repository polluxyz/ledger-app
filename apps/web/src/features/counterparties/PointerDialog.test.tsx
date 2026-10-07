import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { PointerDialog, type PointerDialogTarget } from './PointerDialog';

const counterparties: Counterparty[] = [
  {
    id: 'counterparty-1',
    name: '小明',
    displayName: '明哥',
    askMerge: false,
    balance: 0,
    ledgerParts: [],
    totalBalance: 0,
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'counterparty-2',
    name: '房東',
    displayName: '房東阿姨',
    askMerge: false,
    balance: 0,
    ledgerParts: [],
    totalBalance: 0,
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

const target: PointerDialogTarget = {
  ledgerId: 'ledger-1',
  personId: 'person-1',
  personName: '小安',
  counterpartyId: 'counterparty-1',
};

// 用 fetch mock 驗證指向彈窗的預設值、PUT body、取消與後端錯誤呈現，不啟動 API。
describe('PointerDialog', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(dialogTarget: PointerDialogTarget | null = target, onClose = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = render(
      <QueryClientProvider client={queryClient}>
        <PointerDialog target={dialogTarget} counterparties={counterparties} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose, ...result };
  }

  function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  it('defaults to the effective pointer and offers every supplied object plus no pointer', () => {
    renderDialog();

    const select = screen.getByLabelText('指向已建立的對象');
    expect(select).toHaveValue('counterparty-1');
    expect(screen.getByRole('option', { name: '明哥' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '房東阿姨' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '不指向' })).toBeInTheDocument();
  });

  it('saves a selected object and closes after success', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      expect(String(input)).toContain('/ledgers/ledger-1/people/person-1/pointer');
      expect(init?.method).toBe('PUT');
      return jsonResponse({ counterpartyId: 'counterparty-2', auto: false });
    });

    await user.selectOptions(screen.getByLabelText('指向已建立的對象'), 'counterparty-2');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0];
    expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
      counterpartyId: 'counterparty-2',
    });
  });

  it('defaults a null pointer to no pointer and saves null', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ ...target, counterpartyId: null });
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      return jsonResponse({ counterpartyId: null, auto: false });
    });

    expect(screen.getByLabelText('指向已建立的對象')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      counterpartyId: null,
    });
  });

  it('cancels without sending a pointer request', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    fetchMock.mockImplementation(() => Promise.reject(new Error('不應送出指向')));

    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the backend message inside the dialog after a failed save', async () => {
    const user = userEvent.setup();
    renderDialog();
    fetchMock.mockImplementation(() =>
      jsonResponse({ statusCode: 409, message: '帳本已退出', error: 'Conflict' }, 409),
    );

    await user.click(screen.getByRole('button', { name: '儲存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('帳本已退出');
    expect(screen.getByRole('dialog', { name: '小安' })).toBeInTheDocument();
  });
});
