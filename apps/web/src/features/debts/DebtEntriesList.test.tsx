import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtEntry } from '@ledger/shared';
import rowStyles from './DebtRow.module.css';
import styles from './DebtEntriesList.module.css';
import miniStyles from './MiniOweArrow.module.css';
import { DebtEntriesList } from './DebtEntriesList';

/**
 * DebtEntriesList 驗 2026-10-08 的列操作改版：方向箭頭接線（誰欠誰，由
 * entry-flow 決定）、「⋯」選單的開關與鍵盤行為、撤銷預覽，以及分帳紀錄走分帳的修改與撤銷。
 * 方向規則本身由 entry-flow.test.ts 鎖住，這裡只驗清單把它接對。
 */
describe('DebtEntriesList', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const entry = (overrides: Partial<DebtEntry> = {}): DebtEntry => ({
    id: 'entry-1',
    counterpartyId: 'cp-1',
    kind: 'LEND',
    delta: 12_000,
    date: '2026-09-01T04:00:00.000Z',
    note: null,
    transactionId: 'txn-1',
    recorded: {
      ledgerId: 'ledger-1',
      accountId: 'account-1',
      title: null,
      categoryId: null,
      categoryIcon: null,
    },
    splitId: null,
    settlesEntryId: null,
    difference: null,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-09-01T04:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function mockDelete(status = 204) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status }));
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  function renderList(
    entries: DebtEntry[],
    editable = true,
    onEditSplit?: (id: string) => void,
    balance = 20_000,
  ) {
    return render(
      <QueryClientProvider client={queryClient}>
        <DebtEntriesList
          entries={entries}
          displayName="小明"
          balance={balance}
          editable={editable}
          onEditSplit={onEditSplit}
        />
      </QueryClientProvider>,
    );
  }

  async function openMenu(row: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(row).getByRole('button', { name: '更多操作' }));
    return within(row).getByRole('menu');
  }

  it('wires owe arrows from the flow direction and keeps adjustments on the check icon', () => {
    renderList([
      entry({ id: 'lend', kind: 'LEND', delta: 1_000 }), // 對方欠我：小 → 我
      entry({ id: 'borrow', kind: 'BORROW', delta: -1_000 }), // 我欠對方：我 → 小
      entry({ id: 'collect', kind: 'COLLECT', delta: -1_000 }), // 還款：小 → 我＋回頭圖示
      entry({ id: 'settle', kind: 'SETTLEMENT', delta: 1_000 }), // 打勾，不畫箭頭
    ]);

    const rows = screen.getAllByRole('listitem');
    const rowLayout = rows[0]!.querySelector(`.${rowStyles.row}`);
    expect(rowLayout).toBeInTheDocument();
    expect(rowLayout?.querySelector(`.${rowStyles.date}`)).toBeInTheDocument();
    expect(rowLayout?.querySelector(`.${rowStyles.arrow}`)).toBeInTheDocument();
    expect(rowLayout?.querySelector(`.${rowStyles.amount}`)).toBeInTheDocument();
    expect(rowLayout?.querySelector(`.${rowStyles.actions}`)).toBeInTheDocument();
    const avatars = (row: HTMLElement) =>
      within(row)
        .getAllByText(/^(小|我)$/)
        .map((node) => node.textContent);
    expect(avatars(rows[0]!)).toEqual(['小', '我']);
    expect(avatars(rows[1]!)).toEqual(['我', '小']);
    expect(avatars(rows[2]!)).toEqual(['小', '我']);
    expect(rows[0]!.querySelector('[title="小明"]')).toHaveTextContent('小');
    expect(rows[0]!.querySelector('[title="我"]')).toHaveTextContent('我');
    // 還款線中點有「回頭」圖示；其他箭頭沒有。lucide 圖示沒有隱含角色，用 class 驗。
    expect(rows[2]!.querySelector('svg.lucide-undo-2')).not.toBeNull();
    expect(rows[0]!.querySelector('svg.lucide-undo-2')).toBeNull();
    // 調整紀錄只有打勾圖示，兩端頭貼不出現。
    expect(within(rows[3]!).queryByText(/^(小|我)$/)).not.toBeInTheDocument();
    expect(rows[3]!.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('shows the category icon and title right after the arrow, before the note', () => {
    const recorded = {
      ledgerId: 'ledger-1',
      accountId: 'account-1',
      title: '晚餐',
      categoryId: 'category-1',
      categoryIcon: 'food',
    };
    renderList([
      entry({ id: 'titled', note: 'AA', recorded }),
      entry({ id: 'plain', note: '借款' }),
      entry({ id: 'unrecorded', transactionId: null, recorded: null, note: '舊帳' }),
    ]);

    const [titled, plain, unrecorded] = screen.getAllByRole('listitem');
    const cells = Array.from(titled!.querySelector(`.${rowStyles.row}`)!.children);
    const titleCell = within(titled!).getByText('晚餐').closest(`.${styles.title}`)!;
    expect(cells.indexOf(titleCell)).toBe(
      cells.indexOf(titled!.querySelector(`.${rowStyles.arrow}`)!) + 1,
    );
    expect(titleCell.querySelector('[data-category-icon="food"]')).not.toBeNull();
    expect(within(titled!).getByText('AA')).toBeInTheDocument();
    // 沒名稱、沒分類的紀錄不多出空的名稱格。
    expect(plain!.querySelector(`.${styles.title}`)).toBeNull();
    expect(unrecorded!.querySelector(`.${styles.title}`)).toBeNull();
  });

  it('uses the existing carry-over label when the debt entry has no source ledger name', () => {
    renderList([
      entry({
        kind: 'LEDGER_CARRY_OVER',
        delta: 5000,
        transactionId: null,
        recorded: null,
      }),
    ]);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('帳本轉入')).toBeInTheDocument();
    expect(within(row).queryByText('未記帳')).not.toBeInTheDocument();
  });

  it('omits the more-actions menu in read-only mode but keeps the split badge', () => {
    renderList([entry({ splitId: 'split-1' })], false);

    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.getByText('分帳')).toBeInTheDocument();
  });

  it('hides row actions for a settlement bound to its repayment and keeps them for an unbound one', () => {
    renderList([
      entry({ id: 'bound-settlement', kind: 'SETTLEMENT', settlesEntryId: 'repayment-1' }),
      entry({ id: 'legacy-settlement', kind: 'SETTLEMENT', settlesEntryId: null }),
    ]);

    const [boundRow, unboundRow] = screen.getAllByRole('listitem');
    expect(within(boundRow!).queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(within(unboundRow!).getByRole('button', { name: '更多操作' })).toBeInTheDocument();
  });

  it('opens the menu with edit and undo, then closes on Escape and refocuses the trigger', async () => {
    const user = userEvent.setup();
    renderList([entry()]);

    const row = screen.getByRole('listitem');
    const trigger = within(row).getByRole('button', { name: '更多操作' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = within(row).getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '修改' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '撤銷' })).toBeInTheDocument();

    trigger.focus();
    await user.keyboard('{Escape}');
    expect(within(row).queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作' })).toHaveFocus();
  });

  it('closes the menu when clicking outside of it', async () => {
    const user = userEvent.setup();
    renderList([entry(), entry({ id: 'entry-2' })]);

    const [firstRow] = screen.getAllByRole('listitem');
    await user.click(within(firstRow!).getByRole('button', { name: '更多操作' }));
    expect(within(firstRow!).getByRole('menu')).toBeInTheDocument();

    // 點另一列的「⋯」＝選單外按下：先收舊的再開新的，同時只有一個選單。
    await user.click(
      within(screen.getAllByRole('listitem')[1]!).getByRole('button', { name: '更多操作' }),
    );
    expect(within(firstRow!).queryByRole('menu')).not.toBeInTheDocument();
    expect(within(screen.getAllByRole('listitem')[1]!).getByRole('menu')).toBeInTheDocument();
  });

  it('edits a normal entry and previews its balance change before undoing it', async () => {
    const user = userEvent.setup();
    mockDelete();
    renderList([entry()]);

    const row = screen.getByRole('listitem');
    const menu = await openMenu(row, user);
    await user.click(within(menu).getByRole('menuitem', { name: '修改' }));
    expect(await screen.findByRole('dialog', { name: '修改往來紀錄' })).toBeInTheDocument();

    const menuAgain = await openMenu(row, user);
    await user.click(within(menuAgain).getByRole('menuitem', { name: '撤銷' }));
    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(
      within(confirmation).getByRole('group', {
        name: '撤銷後，往來從「小明欠你的金額 $200」變成「小明欠你的金額 $80」。',
      }),
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: '撤銷' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/debt-entries/entry-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('offers only undo for adjustment records', async () => {
    const user = userEvent.setup();
    renderList([entry({ kind: 'FORGIVE', delta: -400 })]);

    const row = screen.getByRole('listitem');
    const menu = await openMenu(row, user);
    expect(within(menu).queryByRole('menuitem', { name: '修改' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '撤銷' })).toBeInTheDocument();
  });

  it('shows 兩清 without an arrow when undo returns the balance to zero', async () => {
    const user = userEvent.setup();
    renderList([entry({ delta: 20_000 })], true, undefined, 20_000);

    const row = screen.getByRole('listitem');
    const menu = await openMenu(row, user);
    await user.click(within(menu).getByRole('menuitem', { name: '撤銷' }));

    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    const preview = within(confirmation).getByRole('group', {
      name: '撤銷後，往來從「小明欠你的金額 $200」變成「兩清」。',
    });
    expect(within(preview).getByText('兩清')).toBeInTheDocument();
    expect(preview.querySelectorAll(`.${miniStyles.mini}`)).toHaveLength(1);
  });

  it('shows a repayment difference under the settled row without its own actions', async () => {
    const user = userEvent.setup();
    renderList(
      [
        entry({
          id: 'repay',
          kind: 'COLLECT',
          delta: -9_300,
          difference: { transactionId: 'difference-1', type: 'EXPENSE', amount: 300 },
        }),
        entry({ id: 'lend', kind: 'LEND', delta: 9_300 }),
      ],
      true,
      undefined,
      0,
    );

    const repayment = screen.getAllByRole('listitem')[0]!;
    expect(within(repayment).getByText('還清')).toBeInTheDocument();
    const differenceRow = repayment.querySelector(`.${styles.differenceRow}`) as HTMLElement;
    expect(differenceRow).toHaveTextContent('└−$3少收');
    expect(
      within(differenceRow).queryByRole('button', { name: '更多操作' }),
    ).not.toBeInTheDocument();
    const menu = await openMenu(repayment, user);
    await user.click(within(menu).getByRole('menuitem', { name: '撤銷' }));

    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(
      within(confirmation).getByRole('group', {
        name: '撤銷後，往來從「兩清」變成「小明欠你的金額 $93」。',
      }),
    ).toBeInTheDocument();
  });

  it('reverses the preview arrow when undo crosses zero', async () => {
    const user = userEvent.setup();
    renderList([entry({ delta: 10_000 })], true, undefined, 5_000);

    const row = screen.getByRole('listitem');
    const menu = await openMenu(row, user);
    await user.click(within(menu).getByRole('menuitem', { name: '撤銷' }));

    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    const preview = within(confirmation).getByRole('group', {
      name: '撤銷後，往來從「小明欠你的金額 $50」變成「你欠小明的金額 $50」。',
    });
    expect(
      within(preview)
        .getAllByTitle(/^(小明|我)$/)
        .map((node) => node.getAttribute('title')),
    ).toEqual(['小明', '我', '我', '小明']);
  });

  it('routes split entries to the split editor and split deletion', async () => {
    const user = userEvent.setup();
    mockDelete();
    const onEditSplit = vi.fn();
    renderList([entry({ splitId: 'split-1', kind: 'PAID_FOR_THEM' })], true, onEditSplit);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('分帳')).toBeInTheDocument();

    const menu = await openMenu(row, user);
    await user.click(within(menu).getByRole('menuitem', { name: '修改' }));
    expect(onEditSplit).toHaveBeenCalledWith('split-1');

    const menuAgain = await openMenu(row, user);
    await user.click(within(menuAgain).getByRole('menuitem', { name: '撤銷' }));
    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(
      within(confirmation).getByRole('group', {
        name: '撤銷後，往來從「小明欠你的金額 $200」變成「小明欠你的金額 $80」。',
      }),
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: '撤銷' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/splits/split-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('shows the counterpart notification below a synced undo preview', async () => {
    const user = userEvent.setup();
    renderList([entry({ splitId: 'split-1', sync: 'SYNCED' })]);

    const row = screen.getByRole('listitem');
    const menu = await openMenu(row, user);
    await user.click(within(menu).getByRole('menuitem', { name: '撤銷' }));

    const confirmation = await screen.findByRole('dialog', { name: '撤銷這筆？' });
    expect(within(confirmation).getByText('對方會收到通知')).toBeInTheDocument();
    expect(confirmation).not.toHaveTextContent('分帳？');
  });
});
