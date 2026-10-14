import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary, SettlementSummary } from '@ledger/shared';
import { SettlementView } from './SettlementView';
import styles from './SettlementView.module.css';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-hua' } }),
}));

/**
 * 結清檢視（SettlementView）單元測試：
 *
 * 驗證轉帳改為方塊格（shared-tiles）之行為：
 * 1. 寬螢幕（兩欄）：點擊方塊後，結清表單插入在該排方塊最後一格之後、下一排方塊之前（全寬展開）。
 * 2. 窄螢幕（一欄）：點擊方塊後，結清表單插入在被點選方塊的正下方、下一個方塊之前。
 * 3. 單一展開：一次只展開一個表單，點擊同一個方塊收起，點擊不同方塊則切換展開目標。
 * 4. 方塊樣式：選中的方塊具有 selected 樣式，VIEWER 角色不可點擊，無轉帳時顯示「兩清」。
 */
describe('SettlementView', () => {
  const fetchMock = vi.fn();
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '花蓮三日',
    currency: 'TWD',
    kind: 'SHARED',
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  const multiPeople: SettlementSummary['people'] = [
    {
      person: { id: 'person-hua', name: '小華', userId: 'user-hua', status: 'MEMBER' },
      net: 305000,
    },
    {
      person: { id: 'person-min', name: '小明', userId: 'user-min', status: 'MEMBER' },
      net: -100000,
    },
    {
      person: { id: 'person-mei', name: '小美', userId: 'user-mei', status: 'MEMBER' },
      net: -100000,
    },
    {
      person: { id: 'person-dong', name: '阿東', userId: 'user-dong', status: 'MEMBER' },
      net: -105000,
    },
  ];

  const fourSuggestions = [
    { fromPersonId: 'person-min', toPersonId: 'person-hua', amount: 205000 },
    { fromPersonId: 'person-mei', toPersonId: 'person-hua', amount: 100000 },
    { fromPersonId: 'person-dong', toPersonId: 'person-hua', amount: 105000 },
    { fromPersonId: 'person-min', toPersonId: 'person-mei', amount: 50000 },
  ];

  const summary: SettlementSummary = {
    people: multiPeople,
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
              { id: 'person-mei', name: '小美', userId: 'user-mei', status: 'MEMBER' },
              { id: 'person-dong', name: '阿東', userId: 'user-dong', status: 'MEMBER' },
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

  it('shows transfer suggestions in tiles without net amounts, and clicks the tile to open the form inline', async () => {
    const user = userEvent.setup();
    const onSettle = renderView();

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '淨額' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ledgers/ledger-1/settlement-summary'),
      expect.objectContaining({ method: 'GET' }),
    );

    const tileButton = screen.getByRole('button', { name: '小明欠我 $2,050' });
    expect(tileButton).toHaveAttribute('aria-expanded', 'false');
    expect(tileButton).not.toHaveClass(styles.selected!);

    await user.click(tileButton);
    expect(tileButton).toHaveAttribute('aria-expanded', 'true');
    expect(tileButton).toHaveClass(styles.selected!);
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
    expect(tileButton).toHaveAttribute('aria-expanded', 'false');
    expect(tileButton).not.toHaveClass(styles.selected!);
  });

  it('positions the expanded form after the active row in wide screen (2 columns) with single expansion', async () => {
    const user = userEvent.setup();
    responseSummary = {
      people: multiPeople,
      suggestions: fourSuggestions,
    };
    renderView();

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    const grid = screen.getByRole('list');
    expect(grid).toHaveClass(styles.suggestionGrid!);

    const btn0 = screen.getByRole('button', { name: '小明欠我 $2,050' });
    const btn1 = screen.getByRole('button', { name: '小美欠我 $1,000' });
    const btn2 = screen.getByRole('button', { name: '阿東欠我 $1,050' });
    const btn3 = screen.getByRole('button', { name: '小明欠小美 $500' });

    // 寬螢幕兩欄：第一排為 [btn0, btn1]，第二排為 [btn2, btn3]。
    // 點擊第一排的 btn0，表單應插入在 btn1 之後、btn2 之前。
    await user.click(btn0);
    expect(btn0).toHaveAttribute('aria-expanded', 'true');
    expect(btn0).toHaveClass(styles.selected!);
    expect(btn1).toHaveAttribute('aria-expanded', 'false');
    expect(btn1).not.toHaveClass(styles.selected!);

    expect(grid.children.length).toBe(5);
    expect(grid.children[0]).toContainElement(btn0);
    expect(grid.children[1]).toContainElement(btn1);
    expect(grid.children[2]).toHaveClass(styles.formRow!);
    expect(grid.children[2]).toContainElement(screen.getByRole('button', { name: '取消' }));
    expect(grid.children[3]).toContainElement(btn2);
    expect(grid.children[4]).toContainElement(btn3);

    // 點擊同一排的另一個方塊 btn1：單一展開切換，表單仍在第一排後方（btn1 之後、btn2 之前）
    await user.click(btn1);
    expect(btn0).toHaveAttribute('aria-expanded', 'false');
    expect(btn0).not.toHaveClass(styles.selected!);
    expect(btn1).toHaveAttribute('aria-expanded', 'true');
    expect(btn1).toHaveClass(styles.selected!);

    expect(grid.children.length).toBe(5);
    expect(grid.children[0]).toContainElement(btn0);
    expect(grid.children[1]).toContainElement(btn1);
    expect(grid.children[2]).toHaveClass(styles.formRow!);
    expect(grid.children[3]).toContainElement(btn2);
    expect(grid.children[4]).toContainElement(btn3);

    // 點擊第二排的 btn2：表單移到第二排後方（btn3 之後）
    await user.click(btn2);
    expect(btn1).toHaveAttribute('aria-expanded', 'false');
    expect(btn2).toHaveAttribute('aria-expanded', 'true');
    expect(btn2).toHaveClass(styles.selected!);

    expect(grid.children.length).toBe(5);
    expect(grid.children[0]).toContainElement(btn0);
    expect(grid.children[1]).toContainElement(btn1);
    expect(grid.children[2]).toContainElement(btn2);
    expect(grid.children[3]).toContainElement(btn3);
    expect(grid.children[4]).toHaveClass(styles.formRow!);

    // 再點同一個方塊 btn2 收起
    await user.click(btn2);
    expect(btn2).toHaveAttribute('aria-expanded', 'false');
    expect(btn2).not.toHaveClass(styles.selected!);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    });
  });

  it('positions the expanded form after the active tile on odd-count wide screen rows', async () => {
    const user = userEvent.setup();
    // 3 條轉帳：第一排 [btn0, btn1]，第二排只有 [btn2]
    responseSummary = {
      people: multiPeople,
      suggestions: fourSuggestions.slice(0, 3),
    };
    renderView();

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    const grid = screen.getByRole('list');
    const btn2 = screen.getByRole('button', { name: '阿東欠我 $1,050' });

    await user.click(btn2);
    expect(btn2).toHaveAttribute('aria-expanded', 'true');
    expect(grid.children.length).toBe(4);
    expect(grid.children[2]).toContainElement(btn2);
    expect(grid.children[3]).toHaveClass(styles.formRow!);
  });

  it('positions the expanded form immediately below the active tile in narrow screen (1 column)', async () => {
    // 模擬窄螢幕媒體查詢 (max-width: 40rem)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 40rem)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const user = userEvent.setup();
    responseSummary = {
      people: multiPeople,
      suggestions: fourSuggestions,
    };
    renderView();

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    const grid = screen.getByRole('list');

    const btn0 = screen.getByRole('button', { name: '小明欠我 $2,050' });
    const btn1 = screen.getByRole('button', { name: '小美欠我 $1,000' });
    const btn2 = screen.getByRole('button', { name: '阿東欠我 $1,050' });

    // 單欄模式：點擊 btn0，表單橫跨列直接插在 btn0 下方、btn1 之前
    await user.click(btn0);
    expect(btn0).toHaveAttribute('aria-expanded', 'true');
    expect(grid.children.length).toBe(5);
    expect(grid.children[0]).toContainElement(btn0);
    expect(grid.children[1]).toHaveClass(styles.formRow!);
    expect(grid.children[2]).toContainElement(btn1);
    expect(grid.children[3]).toContainElement(btn2);

    // 點擊 btn1，表單移到 btn1 下方、btn2 之前
    await user.click(btn1);
    expect(btn0).toHaveAttribute('aria-expanded', 'false');
    expect(btn1).toHaveAttribute('aria-expanded', 'true');
    expect(grid.children.length).toBe(5);
    expect(grid.children[0]).toContainElement(btn0);
    expect(grid.children[1]).toContainElement(btn1);
    expect(grid.children[2]).toHaveClass(styles.formRow!);
    expect(grid.children[3]).toContainElement(btn2);
  });

  it('shows 兩清 when suggestions are empty, and keeps rows non-clickable for viewers', async () => {
    responseSummary = { ...summary, suggestions: [] };
    renderView();

    expect(await screen.findByText('兩清')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '淨額' })).not.toBeInTheDocument();
  });

  it('keeps transfer tiles non-clickable for a viewer', async () => {
    renderView({ ...ledger, role: 'VIEWER' });

    expect(await screen.findByText('小明欠我 $2,050')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '小明欠我 $2,050' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '結清' })).not.toBeInTheDocument();

    const tile = screen.getByText('小明欠我 $2,050').closest(`.${styles.tile!}`);
    expect(tile).toHaveClass(styles.readOnly!);
    expect(tile?.tagName).toBe('DIV');
  });
});
