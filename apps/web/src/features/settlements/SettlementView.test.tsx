import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary, SettlementSummary } from '@ledger/shared';
import { SettlementView } from './SettlementView';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-hua' } }),
}));

/** 結清檢視只顯示轉帳建議與展開的結清表單，不顯示淨額。 */
describe('SettlementView', () => {
  const fetchMock = vi.fn();
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '花蓮三日',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: true,
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const summary: SettlementSummary = {
    people: [
      {
        person: { id: 'person-hua', name: '小華', userId: 'user-hua', status: 'MEMBER' },
        net: 305000,
      },
      {
        person: { id: 'person-min', name: '小明', userId: 'user-min', status: 'MEMBER' },
        net: -100000,
      },
      { person: { id: 'person-guest', name: '阿美', userId: null, status: 'GUEST' }, net: 0 },
    ],
    suggestions: [{ fromPersonId: 'person-min', toPersonId: 'person-hua', amount: 205000 }],
  };
  let responseSummary = summary;

  function renderView(viewLedger = ledger, onSettle = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SettlementView ledger={viewLedger} onSettle={onSettle} />
      </QueryClientProvider>,
    );
    return onSettle;
  }

  beforeEach(() => {
    responseSummary = summary;
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/settlement-summary')) {
        return Promise.resolve(
          new Response(JSON.stringify(responseSummary), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (String(url).endsWith('/people')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'person-hua', name: '小華', userId: 'user-hua', status: 'MEMBER' },
              { id: 'person-min', name: '小明', userId: 'user-min', status: 'MEMBER' },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (String(url).endsWith('/accounts')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows transfer suggestions without net amounts, and clicks the transfer row to open the settlement form inline', async () => {
    const user = userEvent.setup();
    const onSettle = renderView();

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '淨額' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ledgers/ledger-1/settlement-summary'),
      expect.objectContaining({ method: 'GET' }),
    );

    const rowButton = screen.getByRole('button', { name: '小明欠我 $2,050' });
    expect(rowButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(rowButton);
    expect(rowButton).toHaveAttribute('aria-expanded', 'true');
    expect(onSettle).toHaveBeenCalledWith({
      fromPersonId: 'person-min',
      toPersonId: 'person-hua',
      amount: 205000,
    });
    expect(await screen.findByRole('button', { name: '取消' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument(),
    );
    expect(rowButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows 兩清 when suggestions are empty, and keeps rows non-clickable for viewers', async () => {
    responseSummary = { ...summary, suggestions: [] };
    renderView();

    expect(await screen.findByText('兩清')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '淨額' })).not.toBeInTheDocument();
  });

  it('keeps transfer row non-clickable for a viewer', async () => {
    renderView({ ...ledger, role: 'VIEWER' });

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '小明欠我 $2,050' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
  });
});
