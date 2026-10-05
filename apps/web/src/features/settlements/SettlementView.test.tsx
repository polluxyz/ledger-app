import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary, SettlementSummary } from '@ledger/shared';
import { SettlementView } from './SettlementView';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-hua' } }),
}));

/** 結清檢視只顯示 summary API 回傳的淨額與建議，不查或列出過去的結清。 */
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
      return Promise.resolve(new Response(null, { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the API net amounts in order and opens a prefilled suggestion', async () => {
    const user = userEvent.setup();
    const onSettle = renderView();

    expect(await screen.findByText('+$3,050')).toBeInTheDocument();
    expect(screen.getByText('−$1,000')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '淨額' })).getByText('我'),
    ).toBeInTheDocument();
    expect(screen.getByText('小明欠我 $2,050')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ledgers/ledger-1/settlement-summary'),
      expect.objectContaining({ method: 'GET' }),
    );

    await user.click(screen.getByRole('button', { name: '結清' }));
    expect(onSettle).toHaveBeenCalledWith({
      fromPersonId: 'person-min',
      toPersonId: 'person-hua',
      amount: 205000,
    });
  });

  it('omits suggestions when none are returned and hides settlement actions for a viewer', async () => {
    responseSummary = { ...summary, suggestions: [] };
    renderView({ ...ledger, role: 'VIEWER' });

    expect(await screen.findByRole('heading', { name: '淨額' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '建議' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
  });
});
