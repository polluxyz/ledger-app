import {
  createAccount,
  createDebtEntry,
  listAccounts,
  listCategories,
  personalLedger,
} from './api';
import { expect, test } from './fixtures';
import {
  expectRightPanelClosedWithoutAddForm,
  newTransactionForm,
  openDashboard,
  openNewTransaction,
  openTransactions,
  parseAmount,
  selectCategory,
  transactionRow,
  typeCounterparty,
} from './ui';

/**
 * 3i spec §6 的借還編輯主線：用 API 準備帳戶與原始借出，後續透過可及性角色和標籤操作畫面，
 * 驗證結清明細、換帳戶後的可見餘額，以及加入分類與名稱後仍保留借還標籤。
 */
test.describe('3i 借還紀錄可編輯', () => {
  test('少收結清後改帳戶、分類與名稱', async ({ signedInPage: page, userA, request }) => {
    test.setTimeout(120_000);

    const [ledger, accounts] = await Promise.all([
      personalLedger(request, userA.token),
      listAccounts(request, userA.token),
    ]);
    const cash = accounts.find((account) => account.name === '現金' && !account.isTemporary);
    if (!cash) {
      throw new Error('找不到一般帳戶「現金」。');
    }
    const bank = await createAccount(request, userA.token, { name: '銀行' });
    const categories = await listCategories(request, userA.token, ledger.id);
    const incomeCategory = categories.find((category) => category.type === 'INCOME');
    if (!incomeCategory) {
      throw new Error('找不到收入分類。');
    }

    await createDebtEntry(request, userA.token, {
      counterparty: { name: '房東' },
      kind: 'LEND',
      amount: 9_300,
      date: new Date().toISOString(),
      record: { ledgerId: ledger.id, accountId: cash.id },
    });

    await openTransactions(page);
    await openNewTransaction(page);
    const form = newTransactionForm(page);
    await form.getByRole('button', { name: '借還', exact: true }).click();
    await typeCounterparty(form, '房東');
    await form.getByRole('button', { name: '還款', exact: true }).click();
    await expect(form.getByLabel('記在哪本帳本')).toHaveCount(0);
    await form.getByLabel('金額').fill('90');
    await form.getByRole('combobox', { name: /帳戶/ }).selectOption(cash.id);
    await form.getByLabel('以此結清').check();
    await form.getByRole('button', { name: '新增', exact: true }).click();

    const repayment = transactionRow(page, '收回 · 房東');
    await expect(repayment).toHaveCount(1);
    await expect(repayment).toContainText('還清');
    await expect(repayment).toContainText('+$90');
    await expect(repayment).not.toContainText('+$93');
    await expect(repayment).not.toContainText('少收');
    await repayment.getByRole('button', { name: '展開細項', exact: true }).click();
    await expect(repayment).toContainText('欠款');
    await expect(repayment).toContainText('+$93');
    await expect(repayment).toContainText('少收');
    await expect(repayment).toContainText('−$3');

    await openDashboard(page);
    const cashBalanceBefore = parseAmount(await page.getByLabel('現金餘額').innerText());
    const bankBalanceBefore = parseAmount(await page.getByLabel('銀行餘額').innerText());

    await openTransactions(page);
    await transactionRow(page, '收回 · 房東').getByRole('button', { name: /編輯/ }).click();
    const editor = page.getByRole('dialog', { name: '編輯交易' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('金額')).toHaveValue('90');

    const fieldOrder = ['金額', '日期', '分類', '帳戶', '名稱', '備註'];
    const fieldBoxes = await Promise.all(
      fieldOrder.map((field) => editor.getByLabel(field, { exact: true }).boundingBox()),
    );
    expect(fieldBoxes.every((box) => box !== null)).toBe(true);
    const [amountBox, dateBox, categoryBox, accountBox, nameBox, noteBox] = fieldBoxes;
    expect(amountBox!.y).toBeLessThan(dateBox!.y);
    expect(Math.abs(dateBox!.y - categoryBox!.y)).toBeLessThan(2);
    expect(dateBox!.x).toBeLessThan(categoryBox!.x);
    expect(categoryBox!.y).toBeLessThan(accountBox!.y);
    expect(accountBox!.y).toBeLessThan(nameBox!.y);
    expect(nameBox!.y).toBeLessThan(noteBox!.y);

    await editor.getByLabel('帳戶', { exact: true }).selectOption(bank.id);
    await editor.getByRole('button', { name: '儲存', exact: true }).click();
    await expectRightPanelClosedWithoutAddForm(page);

    await openDashboard(page);
    const cashBalanceAfter = parseAmount(await page.getByLabel('現金餘額').innerText());
    const bankBalanceAfter = parseAmount(await page.getByLabel('銀行餘額').innerText());
    expect(cashBalanceAfter).toBe(cashBalanceBefore - 9_000);
    expect(bankBalanceAfter).toBe(bankBalanceBefore + 9_000);

    await openTransactions(page);
    await transactionRow(page, '收回 · 房東').getByRole('button', { name: /編輯/ }).click();
    const categoryEditor = page.getByRole('dialog', { name: '編輯交易' });
    await selectCategory(categoryEditor, incomeCategory.name);
    await categoryEditor.getByLabel('名稱', { exact: true }).fill('押金退款');
    await categoryEditor.getByRole('button', { name: '儲存', exact: true }).click();
    await expectRightPanelClosedWithoutAddForm(page);

    const updatedRepayment = transactionRow(page, '收回 · 房東');
    await expect(updatedRepayment.getByText('收回 · 房東', { exact: true })).toBeVisible();
    await expect(updatedRepayment.getByText('押金退款', { exact: true })).toBeVisible();
  });
});
