import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary, SettlementSummary } from '@ledger/shared';
import { SharedSettlementsView } from './SharedSettlementsView';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-hua' } }),
}));

/**
 * 共享分頁結清檢視（SharedSettlementsView）整合測試：
 *
 * 驗證依帳本分組的卡片呈現、單一帳本展開管理與無共享帳本之提示。
 */
describe('SharedSettlementsView', () => {
  const fetchMock = vi.fn();
  const sharedLedger: LedgerSummary = {
    id: 'ledger-shared-1',
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
        net: 205000,
      },
      {
        person: { id: 'person-min', name: '小明', userId: 'user-min', status: 'MEMBER' },
        net: -205000,
      },
    ],
    suggestions: [{ fromPersonId: 'person-min', toPersonId: 'person-hua', amount: 205000 }],
  };

  let ledgersList: LedgerSummary[] = [sharedLedger];

  function renderView() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SharedSettlementsView settleIntent={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    ledgersList = [sharedLedger];
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/ledgers?includeArchived=true') || urlStr.endsWith('/ledgers')) {
        return Promise.resolve(
          new Response(JSON.stringify(ledgersList), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (urlStr.includes('/settlement-summary')) {
        return Promise.resolve(
          new Response(JSON.stringify(summary), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (urlStr.endsWith('/people')) {
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
      if (urlStr.endsWith('/accounts')) {
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

  it('renders a card per shared ledger with its heading and clickable transfer tile', async () => {
    const user = userEvent.setup();
    renderView();

    expect(await screen.findByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    const tile = await screen.findByRole('button', { name: '小明欠我 $2,050' });
    expect(tile).toHaveAttribute('aria-expanded', 'false');

    await user.click(tile);
    expect(tile).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('displays empty message when no shared ledgers are present', async () => {
    ledgersList = [];
    renderView();

    expect(await screen.findByText('目前沒有共享帳本。')).toBeInTheDocument();
  });
});
