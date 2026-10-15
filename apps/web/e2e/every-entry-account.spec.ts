import { addMember, createLedger, listAccounts, listCategories, personalLedger } from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  debtEntry,
  debtRow,
  entryMenu,
  expandDebtRow,
  openDebtsTab,
  openNewTransaction,
  openTransactions,
  selectCategory,
  switchLedger,
  transactionRow,
  typeCounterparty,
  undoEntry,
} from './ui';

/**
 * 3h spec §6 的兩條 Web 主線。使用真實 API 建立共享帳本與成員，借還、共享支出與換帳戶都由
 * Playwright 操作畫面；再用 API 核對餘額與臨時帳戶狀態，覆蓋往來紀錄、明細和帳戶頁。
 */

test('少收結清主線：還款下顯示分支，撤銷後往來餘額回復', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  test.setTimeout(120_000);
  const [ledger, accounts] = await Promise.all([
    personalLedger(request, userA.token),
    listAccounts(request, userA.token),
  ]);
  const cash = accounts.find((account) => account.name === '現金' && !account.isTemporary);
  if (!cash) {
    throw new Error('找不到甲的現金帳戶。');
  }
  const originalCash = cash.balance;

  await openTransactions(page);
  await openNewTransaction(page);
  const newForm = page.getByRole('group', { name: '新增一筆交易' });
  await newForm.getByRole('button', { name: '借還', exact: true }).click();
  await typeCounterparty(newForm, '房東');
  await newForm
    .getByRole('group', { name: '往來種類' })
    .getByRole('button', { name: '借出', exact: true })
    .click();
  await newForm.getByLabel('金額').fill('93');
  await newForm.getByLabel('記在哪本帳本').selectOption(ledger.id);
  await newForm.getByRole('combobox', { name: /帳戶/ }).selectOption(cash.id);
  await newForm.getByRole('button', { name: '新增', exact: true }).click();
  await expect
    .poll(async () => {
      return (await listAccounts(request, userA.token)).find((account) => account.id === cash.id)
        ?.balance;
    })
    .toBe(originalCash - 9_300);

  await openDebtsTab(page, '個人');
  const openDebt = await expandDebtRow(page, /^房東/);
  await openDebt.getByRole('button', { name: '記一筆', exact: true }).click();
  const repaymentForm = openDebt;
  await repaymentForm
    .getByRole('group', { name: '往來種類' })
    .getByRole('button', { name: '還款', exact: true })
    .click();
  await repaymentForm.getByLabel('金額').fill('90');
  await repaymentForm.getByLabel('記在哪本帳本').selectOption(ledger.id);
  await repaymentForm.getByRole('combobox', { name: /帳戶/ }).selectOption(cash.id);
  await repaymentForm.getByLabel('以此結清').check();
  await repaymentForm.getByRole('button', { name: '新增', exact: true }).click();
  await expect(debtRow(page, /^房東/)).toHaveCount(0);

  await openDebtsTab(page, '歷史');
  const history = await expandDebtRow(page, /^房東/);
  const repayment = debtEntry(history, '房東還我 $93');
  await expect(repayment).toContainText('還清');
  const debtDifference = repayment.getByLabel(/少收/);
  await expect(debtDifference).toBeVisible();
  await expect(debtDifference).toContainText('└');
  await expect(entryMenu(debtDifference)).toHaveCount(0);

  const detailSwitch = page
    .getByRole('group', { name: '檢視', exact: true })
    .getByRole('button', { name: '明細', exact: true });
  await detailSwitch.click();
  await expect(detailSwitch).toHaveAttribute('aria-pressed', 'true');
  const repaymentTransaction = transactionRow(page, '還清');
  await expect(repaymentTransaction).toContainText('房東');
  // 3h 修訂 1：還款列是實收 90，分支開頭是還清的 93。
  await expect(repaymentTransaction).toContainText('+$90');
  const transactionDifference = page.getByRole('listitem', { name: /少收/ });
  await expect(transactionDifference).toBeVisible();
  await expect(transactionDifference).toContainText('└');
  await expect(transactionDifference).toContainText('+$93');

  await openDebtsTab(page, '歷史');
  const undoHistory = await expandDebtRow(page, /^房東/);
  await undoEntry(page, debtEntry(undoHistory, '房東還我 $93'));
  await expect(debtRow(page, /^房東/)).toHaveCount(0);

  await openDebtsTab(page, '個人');
  const restoredDebt = await expandDebtRow(page, /^房東/);
  await expect(debtRow(page, /^房東/)).toContainText('房東欠你 $93');
  await expect(debtEntry(restoredDebt, '我借給房東 $93')).toBeVisible();
  await expect
    .poll(async () => {
      return (await listAccounts(request, userA.token)).find((account) => account.id === cash.id)
        ?.balance;
    })
    .toBe(originalCash - 9_300);

  await openTransactions(page);
  const detailsSwitch = page
    .getByRole('group', { name: '檢視', exact: true })
    .getByRole('button', { name: '明細', exact: true });
  await detailsSwitch.click();
  await expect(transactionRow(page, '還清')).toHaveCount(0);
  await expect(page.getByRole('listitem', { name: /少收/ })).toHaveCount(0);
});

test('臨時帳戶主線：本人把共享支出換到現金後，空的臨時帳戶隱藏', async ({
  signedInPage: pageA,
  openAs,
  userA,
  userB,
  request,
}) => {
  test.setTimeout(120_000);
  const ledger = await createLedger(request, userA.token, {
    name: '共享代墊主線',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });
  const expense = (await listCategories(request, userA.token, ledger.id)).find(
    (category) => category.type === 'EXPENSE',
  );
  if (!expense) {
    throw new Error('共享帳本找不到支出分類。');
  }

  await pageA.reload();
  await switchLedger(pageA, ledger.name);
  await openTransactions(pageA);
  await openNewTransaction(pageA);
  const form = pageA.getByRole('group', { name: '新增一筆交易' });
  await form.getByLabel('金額').fill('600');
  await selectCategory(form, expense.name);
  await form.getByLabel('名稱').fill('乙代墊晚餐');
  await form.getByRole('button', { name: '改為選付款人' }).click();
  const payer = form.getByRole('combobox', { name: '付款人' });
  await payer.fill('乙');
  await form.getByRole('option', { name: '乙', exact: true }).click();
  await form.getByRole('button', { name: '新增', exact: true }).click();
  await expect(transactionRow(pageA, '乙代墊晚餐')).toBeVisible();

  const pageB = await openAs(userB);
  await switchLedger(pageB, ledger.name);
  await openTransactions(pageB);
  const expenseRow = transactionRow(pageB, '乙代墊晚餐');
  const temporaryAccount = (await listAccounts(request, userB.token)).find(
    (account) => account.isTemporary,
  );
  if (!temporaryAccount) {
    throw new Error('乙的臨時帳戶不存在。');
  }
  await expect
    .poll(async () => {
      return (await listAccounts(request, userB.token)).find((account) => account.isTemporary)
        ?.hasTransactions;
    })
    .toBe(true);
  await expect(expenseRow.getByRole('button', { name: '臨時帳戶' })).toBeVisible();

  await pageB
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '帳戶' })
    .click();
  await expect(pageB.getByRole('heading', { level: 2, name: '帳戶' })).toBeVisible();
  const temporaryRow = pageB.getByRole('listitem').filter({ hasText: '臨時帳戶' });
  await expect(temporaryRow).toHaveCount(1);

  await openTransactions(pageB);
  await switchLedger(pageB, ledger.name);
  const currentExpenseRow = transactionRow(pageB, '乙代墊晚餐');
  await currentExpenseRow.getByRole('button', { name: '臨時帳戶' }).click();
  const changeAccountDialog = pageB.getByRole('dialog', { name: '補帳戶' });
  await changeAccountDialog.getByLabel('帳戶').selectOption({ label: '現金' });
  const accountResponse = pageB.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/account'),
  );
  await changeAccountDialog.getByRole('button', { name: '儲存', exact: true }).click();
  expect((await accountResponse).ok()).toBe(true);

  await expect(currentExpenseRow.getByRole('button', { name: '臨時帳戶' })).toHaveCount(0);
  await expect
    .poll(async () => {
      return (await listAccounts(request, userB.token)).find((account) => account.isTemporary)
        ?.hasTransactions;
    })
    .toBe(false);

  await pageB
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '帳戶' })
    .click();
  await expect(pageB.getByRole('heading', { level: 2, name: '帳戶' })).toBeVisible();
  await expect(pageB.getByRole('listitem').filter({ hasText: '臨時帳戶' })).toHaveCount(0);
});
