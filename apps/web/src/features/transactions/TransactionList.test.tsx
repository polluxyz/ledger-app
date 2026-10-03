import type { Transaction } from '@ledger/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TransactionList } from './TransactionList';
import styles from './TransactionList.module.css';

/**
 * 交易表格的呈現契約（phase-2h D16、D17）。
 *
 * 這個 suite 釘四件事：
 *
 * 1. **DOM 結構**——日期標題不是 `<li>`，所以 `<li>` 的數量必須等於交易筆數。
 *    e2e 有多條斷言靠 listitem 數筆數，結構一變就整批紅。
 * 2. **整列可點**——點空白處是編輯，點操作鈕只做那顆鈕的事。
 * 3. **無障礙名稱**——按鈕改成只有圖示之後，`aria-label` 是唯一的名稱來源。
 * 4. **金額語意色與選取標示**——三種型別各自一個 class，不是「非支出即收入」。
 *
 * 日期字串刻意不帶 `Z`：不帶時區的字串一律以本地時間解讀，分組結果才不會
 * 隨著測試跑在哪個時區而變。
 */
describe('TransactionList', () => {
  /** CSS Modules 的型別是索引簽章，取出來是 `string | undefined`，這裡收斂掉。 */
  const cssClass = (name: string): string => styles[name] ?? name;

  /** 第 index 列。索引存取同樣可能是 undefined，取不到就當場失敗。 */
  function row(index: number): HTMLElement {
    const found = screen.getAllByRole('listitem')[index];
    if (!found) {
      throw new Error(`第 ${index} 列不存在`);
    }
    return found;
  }

  const account = { id: 'acc-1', name: '現金' };
  const creator = { id: 'u1', name: 'Alice' };

  function makeTransaction(overrides: Partial<Transaction> & { id: string }): Transaction {
    return {
      type: 'EXPENSE',
      amount: 12000,
      date: '2026-08-16T12:00:00',
      title: null,
      note: null,
      category: { id: 'cat-1', name: '餐飲' },
      account,
      toAccount: null,
      creator,
      debt: null,
      split: null,
      createdAt: '2026-08-16T12:00:00',
      ...overrides,
    };
  }

  /** 跨三天的 5 筆，順序是後端給的（日期新→舊）。 */
  const transactions: Transaction[] = [
    makeTransaction({ id: 'txn-1' }),
    makeTransaction({
      id: 'txn-2',
      amount: 8000,
      note: '手沖淺焙',
      category: { id: 'cat-2', name: '飲料' },
    }),
    makeTransaction({
      id: 'txn-3',
      date: '2026-08-15T09:00:00',
      type: 'INCOME',
      amount: 3000000,
      category: { id: 'cat-3', name: '薪資' },
    }),
    makeTransaction({
      id: 'txn-4',
      date: '2026-08-15T08:00:00',
      type: 'TRANSFER',
      amount: 500000,
      category: null,
      toAccount: { id: 'acc-2', name: '國泰世華' },
    }),
    makeTransaction({
      id: 'txn-5',
      date: '2026-08-14T20:00:00',
      amount: 25000,
      category: { id: 'cat-4', name: '娛樂' },
    }),
  ];

  function renderList(props: Partial<Parameters<typeof TransactionList>[0]> = {}) {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <TransactionList
        transactions={transactions}
        isLoading={false}
        error={null}
        onEdit={onEdit}
        onRemove={onRemove}
        {...props}
      />,
    );
    return { onEdit, onRemove };
  }

  it('groups consecutive days without turning the headings into list items', () => {
    renderList();

    // 標題若也是 <li>，這裡就會變成 8 個——e2e 數筆數的斷言會整批失準。
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('8月16日 星期日')).toBeInTheDocument();
    expect(screen.getByText('8月15日 星期六')).toBeInTheDocument();
    expect(screen.getByText('8月14日 星期五')).toBeInTheDocument();
  });

  it('edits when the row is clicked and only removes when the bin is clicked', async () => {
    const user = userEvent.setup();
    const { onEdit, onRemove } = renderList();

    const firstRow = row(0);
    await user.click(within(firstRow).getByText('餐飲'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(transactions[0]);

    onEdit.mockClear();
    // 刪除鈕在列之內，點擊會冒泡上來；沒擋住的話按刪除會順便開啟編輯面板。
    await user.click(within(firstRow).getByRole('button', { name: /^刪除/ }));
    expect(onRemove).toHaveBeenCalledWith(transactions[0]);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('still names the action buttons by date and category', () => {
    renderList();

    // 按鈕改成只有圖示之後，aria-label 是唯一的名稱來源，e2e 也靠它。
    expect(screen.getByRole('button', { name: '編輯2026/08/16 的餐飲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除2026/08/16 的餐飲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除2026/08/15 的轉帳' })).toBeInTheDocument();
  });

  // 開發者 2026-09-24：點整列就是編輯，鉛筆圖示是重複的入口，拿掉。但鍵盤使用者
  // 仍要進得了編輯——入口是列的第一格（一顆沒有按鈕外觀的按鈕），按 Enter 就開。
  it('drops the pencil icon but keeps a keyboard way into the editor', async () => {
    const { onEdit } = renderList();
    const user = userEvent.setup();

    expect(screen.queryByTitle('編輯')).not.toBeInTheDocument();

    screen.getByRole('button', { name: '編輯2026/08/16 的餐飲' }).focus();
    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledWith(transactions[0]);
  });

  it('colours each of the three types on its own', () => {
    renderList();

    expect(screen.getByText('-$120')).toHaveClass(cssClass('expense'));
    expect(screen.getByText('+$30,000')).toHaveClass(cssClass('income'));
    // 轉帳既不是支出也不是收入。「非支出即收入」的二分法在這裡就是錯的。
    const transferAmount = screen.getByText('$5,000');
    expect(transferAmount).toHaveClass(cssClass('transfer'));
    expect(transferAmount).not.toHaveClass(cssClass('income'));
  });

  it('marks only the selected row', () => {
    renderList({ selectedId: 'txn-3' });

    expect(row(2)).toHaveClass(cssClass('selected'));
    expect(row(0)).not.toHaveClass(cssClass('selected'));
    expect(row(4)).not.toHaveClass(cssClass('selected'));
  });

  it('keeps both action buttons on an ordinary expense row', async () => {
    // 對照組：唯讀只針對借還交易，一般交易的兩顆鈕與整列可點都不受影響。
    const user = userEvent.setup();
    const { onEdit } = renderList();

    const firstRow = row(0);
    expect(within(firstRow).getByRole('button', { name: /^編輯/ })).toBeInTheDocument();
    expect(within(firstRow).getByRole('button', { name: /^刪除/ })).toBeInTheDocument();

    await user.click(within(firstRow).getByText('餐飲'));
    expect(onEdit).toHaveBeenCalledWith(transactions[0]);
  });

  it('shows split title, payer, personal amount, and expandable counterpart arrows', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const splitTransaction = makeTransaction({
      id: 'split-1',
      title: '晚餐',
      amount: 300000,
      split: {
        id: 'split-1',
        type: 'EXPENSE',
        total: 300000,
        myShare: 75000,
        payer: null,
        counterparts: [
          {
            counterpartyId: 'cp-1',
            name: '小明',
            amount: 75000,
            direction: 'THEY_OWE_ME',
            sync: 'NONE',
          },
          {
            counterpartyId: 'cp-2',
            name: '小華',
            amount: 75000,
            direction: 'THEY_OWE_ME',
            sync: 'NONE',
          },
          {
            counterpartyId: 'cp-3',
            name: '阿美',
            amount: 75000,
            direction: 'THEY_OWE_ME',
            sync: 'NONE',
          },
        ],
      },
    });
    renderList({ transactions: [splitTransaction], onEdit });

    const listRow = row(0);
    expect(within(listRow).getByText('晚餐')).toBeInTheDocument();
    expect(within(listRow).getByText('分帳')).toBeInTheDocument();
    expect(within(listRow).getByText('-$3,000')).toBeInTheDocument();
    expect(within(listRow).queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();

    await user.click(within(listRow).getByRole('button', { name: '展開分帳明細' }));
    expect(within(listRow).getByText('小明欠你 $750')).toBeInTheDocument();
    expect(within(listRow).getByText('小華欠你 $750')).toBeInTheDocument();
    expect(within(listRow).getByText('阿美欠你 $750')).toBeInTheDocument();
    expect(within(listRow).getByText('我 $750')).toBeInTheDocument();
    await user.click(within(listRow).getByRole('button', { name: /^編輯/ }));
    expect(onEdit).toHaveBeenCalledWith(splitTransaction);
  });

  describe('entries linked to a counterparty', () => {
    const debt = {
      entryId: 'entry-1',
      counterpartyId: 'person-1',
      counterpartyName: '小明',
      kind: 'LEND' as const,
      paired: false,
      note: null,
    };

    it('shows the row label and edits a linked debt transaction without a delete action', async () => {
      const user = userEvent.setup();
      const onEditDebtTransaction = vi.fn();
      const transaction = makeTransaction({
        id: 'txn-lend',
        type: 'LEND',
        amount: 100000,
        category: null,
        debt,
      });
      renderList({ transactions: [transaction], onEditDebtTransaction });

      const listRow = row(0);
      expect(screen.getByText('借出 · 小明')).toBeInTheDocument();
      expect(listRow).toHaveClass(cssClass('clickable'));
      const editButton = within(listRow).getByRole('button', { name: /^編輯/ });
      expect(within(listRow).queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();

      await user.click(editButton);
      expect(onEditDebtTransaction).toHaveBeenCalledWith(transaction);
    });

    it('labels a paid expense and sends it to debt transaction editing', async () => {
      const user = userEvent.setup();
      const onEditDebtTransaction = vi.fn();
      renderList({
        transactions: [
          makeTransaction({
            id: 'txn-paid',
            category: { id: 'cat-1', name: '餐飲' },
            debt: { ...debt, kind: 'PAID_FOR_ME' },
          }),
        ],
        onEditDebtTransaction,
      });

      const listRow = row(0);
      expect(screen.getByText('餐飲 · 幫我付 · 小明')).toBeInTheDocument();
      expect(within(listRow).queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();
      await user.click(within(listRow).getByRole('button', { name: /^編輯/ }));
      expect(onEditDebtTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'txn-paid' }),
      );
    });

    it('uses debt.kind for the four advance and collection labels', () => {
      renderList({
        transactions: [
          makeTransaction({
            id: 'paid-for-them',
            type: 'LEND',
            category: null,
            debt: { ...debt, kind: 'PAID_FOR_THEM' },
          }),
          makeTransaction({
            id: 'paid-for-me',
            category: { id: 'cat-1', name: '餐飲' },
            debt: { ...debt, kind: 'PAID_FOR_ME' },
          }),
          makeTransaction({
            id: 'received-for-them',
            type: 'BORROW',
            category: null,
            debt: { ...debt, kind: 'RECEIVED_FOR_THEM' },
          }),
          makeTransaction({
            id: 'received-for-me',
            type: 'INCOME',
            category: { id: 'cat-2', name: '薪資' },
            debt: { ...debt, kind: 'RECEIVED_FOR_ME' },
          }),
        ],
      });

      expect(screen.getByText('代墊 · 小明')).toBeInTheDocument();
      expect(screen.getByText('餐飲 · 幫我付 · 小明')).toBeInTheDocument();
      expect(screen.getByText('代收 · 小明')).toBeInTheDocument();
      expect(screen.getByText('薪資 · 幫我收 · 小明')).toBeInTheDocument();
    });

    it('keeps an unlinked debt transaction unclickable and without a delete action', async () => {
      const user = userEvent.setup();
      renderList({
        transactions: [
          makeTransaction({ id: 'txn-other', type: 'LEND', category: null, debt: null }),
        ],
      });

      const listRow = row(0);
      expect(listRow).not.toHaveClass(cssClass('clickable'));
      expect(within(listRow).queryByRole('button')).not.toBeInTheDocument();
      await user.click(screen.getByText('借出'));
    });

    it('is not clickable without a debt editor even when debt is present', async () => {
      const onEdit = vi.fn();
      renderList({
        transactions: [makeTransaction({ id: 'txn-linked', type: 'LEND', category: null, debt })],
        onEdit,
      });

      const listRow = row(0);
      expect(listRow).not.toHaveClass(cssClass('clickable'));
      expect(within(listRow).queryByRole('button')).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByText('借出 · 小明'));
      expect(onEdit).not.toHaveBeenCalled();
    });
  });
});
