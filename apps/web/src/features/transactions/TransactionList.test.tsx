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
      amount: 120,
      date: '2026-08-16T12:00:00',
      note: null,
      category: { id: 'cat-1', name: '餐飲' },
      account,
      toAccount: null,
      creator,
      debtId: null,
      createdAt: '2026-08-16T12:00:00',
      ...overrides,
    };
  }

  /** 跨三天的 5 筆，順序是後端給的（日期新→舊）。 */
  const transactions: Transaction[] = [
    makeTransaction({ id: 'txn-1' }),
    makeTransaction({
      id: 'txn-2',
      amount: 80,
      note: '手沖淺焙',
      category: { id: 'cat-2', name: '飲料' },
    }),
    makeTransaction({
      id: 'txn-3',
      date: '2026-08-15T09:00:00',
      type: 'INCOME',
      amount: 30000,
      category: { id: 'cat-3', name: '薪資' },
    }),
    makeTransaction({
      id: 'txn-4',
      date: '2026-08-15T08:00:00',
      type: 'TRANSFER',
      amount: 5000,
      category: null,
      toAccount: { id: 'acc-2', name: '國泰世華' },
    }),
    makeTransaction({
      id: 'txn-5',
      date: '2026-08-14T20:00:00',
      amount: 250,
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

  /**
   * 借還帳（3b spec §7）產生的 4 種交易，在一般交易端點是唯讀的——後端改與刪
   * 都回 409 `DEBT_TRANSACTION_READ_ONLY`。這一段釘住三件事：
   *
   * 1. **正負號**看的是錢對帳戶的方向，不是收支：借出、償還為 `-`，借入、收回為 `+`。
   * 2. **列上的名稱**是型別的中文名。這些交易沒有分類，舊邏輯會一律寫成「轉帳」。
   * 3. **沒有編輯與刪除的入口**：兩顆鈕不渲染，整列也不開編輯面板。
   *
   * 每個案例只渲染那一筆，斷言才不必先從 5 列裡把它挑出來。
   */
  describe('debt transactions are read-only here', () => {
    const debtRows = [
      { type: 'LEND', label: '借出', amount: 1000, amountText: '-$1,000' },
      { type: 'BORROW', label: '借入', amount: 2000, amountText: '+$2,000' },
      { type: 'COLLECT', label: '收回', amount: 300, amountText: '+$300' },
      { type: 'REPAY', label: '償還', amount: 400, amountText: '-$400' },
    ] as const;

    function renderDebtRow(type: Transaction['type'], amount: number) {
      const onEdit = vi.fn();
      const onRemove = vi.fn();
      render(
        <TransactionList
          transactions={[
            makeTransaction({ id: 'txn-debt', type, amount, category: null, debtId: 'debt-1' }),
          ]}
          isLoading={false}
          error={null}
          onEdit={onEdit}
          onRemove={onRemove}
        />,
      );
      return { onEdit, onRemove };
    }

    it.each(debtRows)(
      'shows $label as $amountText with no edit or delete button',
      async ({ type, label, amount, amountText }) => {
        const user = userEvent.setup();
        const { onEdit, onRemove } = renderDebtRow(type, amount);

        expect(screen.getByText(label)).toBeInTheDocument();
        // 沒有分類就寫「轉帳」是舊邏輯，借出的錢說成換帳戶是誤導。
        expect(screen.queryByText('轉帳')).not.toBeInTheDocument();
        // 既不是支出也不是收入，沿用轉帳的中性色。
        expect(screen.getByText(amountText)).toHaveClass(cssClass('transfer'));

        expect(screen.queryByRole('button', { name: /^編輯/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^刪除/ })).not.toBeInTheDocument();

        // 整列可點是一般交易的規則（D17），借還交易點了不該有任何反應。
        await user.click(screen.getByText(label));
        expect(onEdit).not.toHaveBeenCalled();
        expect(onRemove).not.toHaveBeenCalled();
      },
    );
  });
});
