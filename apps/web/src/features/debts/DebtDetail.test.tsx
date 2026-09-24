import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Debt, LedgerSummary } from '@ledger/shared';
import { DebtDetail } from './DebtDetail';

/**
 * 債務詳情（右側欄）的驗證重點（spec §4.3、Observable acceptance）：
 *
 * 1. 按鈕依狀態顯示：
 *    - LENT / OPEN：記還款、編輯、免除剩餘、刪除（四顆都有）
 *    - BORROWED / OPEN：沒有免除剩餘
 *    - SETTLED：沒有記還款
 * 2. 結清差額四種文字都取自回應（正負號與白話文字）
 * 3. 還款紀錄中「結清」標籤
 * 4. 三個確認視窗文案（免除後不可撤銷、回到記這筆借還之前、對應交易一起刪除）
 */
describe('DebtDetail', () => {
  const fetchMock = vi.fn();

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

  const baseDebt: Debt = {
    id: 'debt-1',
    direction: 'LENT',
    counterpartyName: '小明',
    principal: 5000,
    date: '2026-09-01T00:00:00.000Z',
    note: '借錢買書',
    outstanding: 3000,
    status: 'OPEN',
    settlementDifference: null,
    transactionId: 'txn-1',
    payments: [
      {
        id: 'pmt-1',
        amount: 2000,
        date: '2026-09-02T00:00:00.000Z',
        note: '第一期',
        transactionId: 'txn-2',
        settles: false,
        createdAt: '2026-09-02T00:00:00.000Z',
      },
    ],
    forgivenAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDetail(debt: Debt = baseDebt) {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/debts/debt-1')) {
        return json(debt);
      }
      return json([]);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClosed = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DebtDetail debtId="debt-1" ledger={ledger} onClosed={onClosed} />
      </QueryClientProvider>,
    );
    return { onClosed };
  }

  describe('action buttons visibility by status and direction', () => {
    it('shows all four buttons for a LENT OPEN debt', async () => {
      renderDetail(baseDebt);

      expect(await screen.findByRole('button', { name: '記還款' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '編輯' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '免除剩餘' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
    });

    it('omits 免除剩餘 for a BORROWED OPEN debt', async () => {
      const borrowedDebt: Debt = {
        ...baseDebt,
        direction: 'BORROWED',
        counterpartyName: '阿華',
      };
      renderDetail(borrowedDebt);

      expect(await screen.findByRole('button', { name: '記還款' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '編輯' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '免除剩餘' })).not.toBeInTheDocument();
    });

    it('omits 記還款 for a SETTLED debt', async () => {
      const settledDebt: Debt = {
        ...baseDebt,
        status: 'SETTLED',
        outstanding: 0,
      };
      renderDetail(settledDebt);

      expect(await screen.findByRole('button', { name: '編輯' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '記還款' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '免除剩餘' })).not.toBeInTheDocument();
    });
  });

  describe('settlement difference preview text from response', () => {
    it('displays positive difference for LENT debt (對方多給)', async () => {
      const debt: Debt = {
        ...baseDebt,
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: 200,
      };
      renderDetail(debt);

      expect(await screen.findByText('結清差額 +200（對方多給）')).toBeInTheDocument();
    });

    it('displays negative difference for LENT debt (對方少還)', async () => {
      const debt: Debt = {
        ...baseDebt,
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: -1000,
      };
      renderDetail(debt);

      expect(await screen.findByText('結清差額 -1,000（對方少還）')).toBeInTheDocument();
    });

    it('displays positive difference for BORROWED debt (我少付)', async () => {
      const debt: Debt = {
        ...baseDebt,
        direction: 'BORROWED',
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: 1000,
      };
      renderDetail(debt);

      expect(await screen.findByText('結清差額 +1,000（我少付）')).toBeInTheDocument();
    });

    it('displays negative difference for BORROWED debt (我多付)', async () => {
      const debt: Debt = {
        ...baseDebt,
        direction: 'BORROWED',
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: -200,
      };
      renderDetail(debt);

      expect(await screen.findByText('結清差額 -200（我多付）')).toBeInTheDocument();
    });

    it('displays zero difference as 結清差額 0', async () => {
      const debt: Debt = {
        ...baseDebt,
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: 0,
      };
      renderDetail(debt);

      expect(await screen.findByText('結清差額 0')).toBeInTheDocument();
    });
  });

  it('marks settled payment with a 結清 badge', async () => {
    const debtWithSettles: Debt = {
      ...baseDebt,
      payments: [
        {
          id: 'pmt-1',
          amount: 2000,
          date: '2026-09-02T00:00:00.000Z',
          note: null,
          transactionId: 'txn-2',
          settles: true,
          createdAt: '2026-09-02T00:00:00.000Z',
        },
      ],
    };
    renderDetail(debtWithSettles);

    expect(await screen.findByText('結清')).toBeInTheDocument();
  });

  describe('confirmation dialog messages', () => {
    it('shows 免除後不可撤銷 in forgive confirm dialog', async () => {
      const user = userEvent.setup();
      renderDetail(baseDebt);

      await user.click(await screen.findByRole('button', { name: '免除剩餘' }));

      const dialog = await screen.findByRole('dialog', { name: '免除剩餘金額' });
      expect(within(dialog).getByText(/免除後不可撤銷/)).toBeInTheDocument();
    });

    it('shows 連同所有還款與交易一起刪除 in debt delete confirm dialog', async () => {
      const user = userEvent.setup();
      renderDetail(baseDebt);

      await user.click(await screen.findByRole('button', { name: '刪除' }));

      const dialog = await screen.findByRole('dialog', { name: '刪除借還' });
      expect(
        within(dialog).getByText(/連同所有還款與交易一起刪除，帳戶餘額會回到記這筆借還之前。/),
      ).toBeInTheDocument();
    });

    it('shows 刪除這筆還款？對應的交易會一起刪除 in payment delete confirm dialog', async () => {
      const user = userEvent.setup();
      renderDetail(baseDebt);

      await user.click(await screen.findByRole('button', { name: /刪除2026\/09\/02的還款/ }));

      const dialog = await screen.findByRole('dialog', { name: '刪除還款' });
      expect(within(dialog).getByText(/刪除這筆還款？對應的交易會一起刪除。/)).toBeInTheDocument();
    });
  });
});
