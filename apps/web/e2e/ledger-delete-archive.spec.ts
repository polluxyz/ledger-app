import { formatMoney } from '@ledger/shared';
import {
  addMember,
  createCounterparty,
  createDebtEntry,
  createLedger,
  createTransaction,
  getCounterparty,
  getLedgerRemovalPreview,
  listAccounts,
  listCategories,
  listLedgers,
  personalLedger,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  expandDebtRow,
  expectBalanceTransition,
  newTransactionForm,
  openDashboard,
  openDebtsTab,
  openNewTransaction,
  selectCategory,
  switchLedger,
} from './ui';

const LEDGER_TO_ARCHIVE_NAME = '封存測試帳本';
const OTHER_LEDGER_NAME = '保留的帳本';
const COUNTERPARTY_NAME = '刪除測試對象';

test('刪除私人帳本會先顯示 API 餘額預覽，刪除後還原現金並撤銷借出', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const ledger = await personalLedger(request, userA.token);
  const cash = (await listAccounts(request, userA.token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!cash) {
    throw new Error('找不到甲的現金帳戶。');
  }
  const cashBefore = cash.balance;
  const counterparty = await createCounterparty(request, userA.token, COUNTERPARTY_NAME);
  // 個人往來列表只顯示有餘額的對象；先放一筆一分的借入，讓對象能從畫面展開，
  // 再由畫面記 $80.01 借出，形成 $80 的預覽餘額。刪除會一併撤銷這兩筆往來。
  await createDebtEntry(request, userA.token, {
    counterparty: { id: counterparty.id },
    kind: 'BORROW',
    amount: 1,
    date: new Date().toISOString(),
    record: { ledgerId: ledger.id, accountId: cash.id },
  });

  // 一般支出與借出都從畫面記錄，確保帳本刪除情境走過使用者的主要動線。
  await openDashboard(page);
  await openNewTransaction(page);
  const expenseForm = newTransactionForm(page);
  await expenseForm.getByLabel('帳戶', { exact: true }).selectOption({ label: cash.name });
  await expenseForm.getByLabel('金額').fill('120');
  await selectCategory(expenseForm, '餐飲');
  await expenseForm.getByRole('button', { name: '新增', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '-$120' })).toBeVisible();

  await openDebtsTab(page, '個人');
  const counterpartyRow = await expandDebtRow(page, new RegExp(`^${COUNTERPARTY_NAME}`));
  await counterpartyRow.getByRole('button', { name: '記一筆', exact: true }).click();
  await expect(counterpartyRow.getByRole('combobox', { name: '對象', exact: true })).toHaveValue(
    COUNTERPARTY_NAME,
  );
  await counterpartyRow.getByLabel('金額').fill('80.01');
  await counterpartyRow.getByLabel('從哪個帳戶借出').selectOption({ label: cash.name });
  await counterpartyRow.getByRole('button', { name: '新增', exact: true }).click();
  await expect
    .poll(async () => (await getCounterparty(request, userA.token, counterparty.id)).balance)
    .toBe(8_000);

  const preview = await getLedgerRemovalPreview(request, userA.token, ledger.id);
  expect(preview.delete).toEqual({ allowed: true, blockedBy: null });
  expect(preview.withdrawsDebts).toBe(true);
  const cashImpact = preview.accounts.find((account) => account.accountId === cash.id);
  const counterpartyImpact = preview.counterparties.find(
    (item) => item.counterpartyId === counterparty.id,
  );
  expect(cashImpact).toBeDefined();
  expect(counterpartyImpact).toBeDefined();
  expect(counterpartyImpact?.balanceAfter).toBe(0);
  expect(cashImpact?.balanceAfter).toBe(cashBefore);

  await page.goto(`/ledgers/${ledger.id}`);
  await page.getByRole('button', { name: '刪除帳本' }).click();
  const dialog = page.getByRole('dialog', { name: `刪除「${ledger.name}」` });
  const accountSection = dialog.getByRole('region', { name: '帳戶' });
  const accountRow = accountSection.getByRole('listitem').filter({ hasText: cash.name });
  await expectBalanceTransition(accountRow, cashImpact!.balance, cashImpact!.balanceAfter);

  const counterpartySection = dialog.getByRole('region', { name: '往來' });
  const impactRow = counterpartySection
    .getByRole('listitem')
    .filter({ hasText: counterparty.displayName });
  await expect(impactRow).toContainText(formatMoney(counterpartyImpact!.balance));
  await expect(impactRow).toContainText('兩清');

  const deleteButton = dialog.getByRole('button', { name: '刪除', exact: true });
  const nameField = dialog.getByLabel('輸入帳本名稱');
  await nameField.fill('錯誤名稱');
  await expect(deleteButton).toBeDisabled();
  await nameField.fill(ledger.name);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page).toHaveURL(/\/ledgers$/);
  await expect(page.getByRole('link', { name: ledger.name, exact: true })).toHaveCount(0);
  await expect
    .poll(async () => {
      const account = (await listAccounts(request, userA.token)).find(
        (item) => item.id === cash.id,
      );
      return account?.balance;
    })
    .toBe(cashBefore);
  await expect
    .poll(async () => (await getCounterparty(request, userA.token, counterparty.id)).balance)
    .toBe(0);
  await expect
    .poll(async () =>
      (await listLedgers(request, userA.token)).some((item) => item.id === ledger.id),
    )
    .toBe(false);
});

test('封存不用輸入名稱；取消封存後帳本回到切換器並可再記帳', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: LEDGER_TO_ARCHIVE_NAME,
    kind: 'SHARED',
  });
  await createLedger(request, userA.token, { name: OTHER_LEDGER_NAME, kind: 'SHARED' });

  await page.goto(`/ledgers/${ledger.id}`);
  await page.getByRole('button', { name: '刪除帳本', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: `刪除「${ledger.name}」` });
  await expect(archiveDialog.getByLabel('請輸入')).toHaveCount(0);
  await archiveDialog.getByRole('button', { name: '封存', exact: true }).click();
  await expect(archiveDialog).toBeHidden();

  await openDashboard(page);
  const switcher = page.getByRole('group', { name: '作用中帳本' });
  await expect(switcher).not.toContainText(ledger.name);

  await page.getByRole('link', { name: '帳本' }).click();
  await page.getByLabel('顯示已封存的帳本').check();
  await page.getByRole('link', { name: ledger.name, exact: true }).click();
  await page.getByRole('button', { name: '取消封存', exact: true }).click();
  const unarchiveDialog = page.getByRole('dialog', { name: `取消封存「${ledger.name}」` });
  await unarchiveDialog.getByRole('button', { name: '取消封存', exact: true }).click();
  await expect(unarchiveDialog).toBeHidden();

  const cash = (await listAccounts(request, userA.token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!cash) {
    throw new Error('找不到甲的現金帳戶。');
  }
  const cashBefore = cash.balance;
  await openDashboard(page);
  await switchLedger(page, ledger.name);
  await openNewTransaction(page);
  const form = newTransactionForm(page);
  await form.getByLabel('帳戶', { exact: true }).selectOption({ label: cash.name });
  await form.getByLabel('金額').fill('25');
  await selectCategory(form, '餐飲');
  await form.getByRole('button', { name: '新增', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '-$25' })).toBeVisible();
  await expect
    .poll(async () => {
      const account = (await listAccounts(request, userA.token)).find(
        (item) => item.id === cash.id,
      );
      return account?.balance;
    })
    .toBe(cashBefore - 2_500);
});

test('共享帳本還有其他成員時只能封存', async ({ signedInPage: page, userA, userB, request }) => {
  const ledger = await createLedger(request, userA.token, {
    name: '不能刪除的共享帳本',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });

  const cash = (await listAccounts(request, userB.token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!cash) {
    throw new Error('找不到乙的現金帳戶。');
  }
  const meal = (await listCategories(request, userB.token, ledger.id)).find(
    (category) => category.name === '餐飲' && category.type === 'EXPENSE',
  );
  if (!meal) {
    throw new Error('共享帳本找不到餐飲支出分類。');
  }
  await createTransaction(request, userB.token, ledger.id, {
    type: 'EXPENSE',
    amount: 30_000,
    date: new Date().toISOString(),
    categoryId: meal.id,
    accountId: cash.id,
  });

  await page.goto(`/ledgers/${ledger.id}`);
  await page.getByRole('button', { name: '刪除帳本' }).click();
  const dialog = page.getByRole('dialog', { name: `刪除「${ledger.name}」` });
  await expect(dialog.getByText('還有其他成員，只能封存', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^(取消|封存)$/ })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '封存', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '刪除', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('輸入帳本名稱')).toHaveCount(0);
});
