import type { Page } from '@playwright/test';
import {
  addMember,
  createAccount,
  createDebtEntry,
  createLedger,
  createTransaction,
  listAccounts,
  listCategories,
  listLedgerTransactions,
  registerUser,
} from './api';
import { expect, test } from './fixtures';
import { openDashboard, openTransactions, switchLedger, transactionRow } from './ui';

const DAILY_LEDGER_NAME = '日常';
const TRAVEL_LEDGER_NAME = '旅行基金';
const HOUSEHOLD_LEDGER_NAME = '家用';

/**
 * 3l 的 Web 主線：刪除私人帳本時分組搬移、複製一般交易，以及個人標註的顯示與取消。
 * 前置帳本與交易透過 API 建立；每個被驗證的操作都從 Playwright 畫面完成。
 */
test.describe('3l 刪除搬移、複製與標註', () => {
  test('SC-N2：分兩組搬移私人帳本交易到共享與私人帳本', async ({
    signedInPage: page,
    userA,
    request,
    openAs,
  }) => {
    test.setTimeout(120_000);

    const dailyLedger = await createLedger(request, userA.token, {
      name: DAILY_LEDGER_NAME,
      kind: 'PERSONAL',
    });
    const travelLedger = await createLedger(request, userA.token, {
      name: TRAVEL_LEDGER_NAME,
      kind: 'PERSONAL',
    });
    const householdLedger = await createLedger(request, userA.token, {
      name: HOUSEHOLD_LEDGER_NAME,
      kind: 'SHARED',
    });
    const xiaomei = await registerUser(request, 'xiaomei@example.com', '小美');
    await addMember(request, userA.token, householdLedger.id, {
      email: xiaomei.email,
      role: 'EDITOR',
    });

    const accounts = await listAccounts(request, userA.token);
    const cash = accounts.find((account) => account.name === '現金' && !account.isTemporary);
    if (!cash) {
      throw new Error('找不到甲的現金帳戶。');
    }
    const creditCard = await createAccount(request, userA.token, {
      name: '信用卡',
      initialBalance: 0,
    });
    const travelAccount = await createAccount(request, userA.token, {
      name: '旅行帳戶',
      initialBalance: 0,
    });
    const travelCategories = await listCategories(request, userA.token, travelLedger.id);
    const expenseCategory = travelCategories.find((category) => category.type === 'EXPENSE');
    if (!expenseCategory) {
      throw new Error('旅行基金找不到支出分類。');
    }

    const planeDeposit = await createTransaction(request, userA.token, travelLedger.id, {
      type: 'EXPENSE',
      amount: 500_000,
      date: new Date().toISOString(),
      title: '機票訂金',
      categoryId: expenseCategory.id,
      accountId: creditCard.id,
    });
    const transfer = await createTransaction(request, userA.token, travelLedger.id, {
      type: 'TRANSFER',
      amount: 200_000,
      date: new Date().toISOString(),
      title: '存入',
      accountId: cash.id,
      toAccountId: travelAccount.id,
    });
    const lend = await createDebtEntry(request, userA.token, {
      counterparty: { name: '阿德' },
      kind: 'LEND',
      amount: 100_000,
      date: new Date().toISOString(),
      title: '借給阿德',
      record: { ledgerId: travelLedger.id, accountId: cash.id },
    });
    const debtTransactionId = lend.entries[0]?.transactionId;
    if (!debtTransactionId) {
      throw new Error('借給阿德沒有建立對應交易。');
    }

    const balancesBefore = (await listAccounts(request, userA.token))
      .map(({ id, balance }) => ({ id, balance }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const xiaomeiBalancesBefore = (await listAccounts(request, xiaomei.token))
      .map(({ id, balance }) => ({ id, balance }))
      .sort((left, right) => left.id.localeCompare(right.id));

    await page.goto(`/ledgers/${travelLedger.id}`);
    await page.getByRole('button', { name: '刪除帳本', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `刪除「${TRAVEL_LEDGER_NAME}」` });
    const accountRows = dialog.getByRole('region', { name: '帳戶' }).getByRole('listitem');
    await expect(accountRows).toHaveCount(3);
    for (const accountName of ['信用卡', '現金', '旅行帳戶']) {
      const row = accountRows.filter({ hasText: accountName });
      await expect(row).toBeVisible();
      await expect(row).toContainText('→');
    }
    const adeRow = dialog
      .getByRole('region', { name: '往來' })
      .getByRole('listitem')
      .filter({ hasText: '阿德' });
    await expect(adeRow).toBeVisible();
    await expect(adeRow).toContainText('→');

    await dialog.getByRole('button', { name: '搬到其他帳本 ›' }).click();
    await completeMove(page, ['存入', '借給阿德'], HOUSEHOLD_LEDGER_NAME);
    const firstMoveSection = dialog.getByRole('region', { name: '搬移' });
    await expect(firstMoveSection.getByRole('listitem')).toHaveCount(1);
    await expect(firstMoveSection).toContainText(HOUSEHOLD_LEDGER_NAME);
    await expect(accountRows).toHaveCount(1);
    await expect(accountRows).toContainText('信用卡');
    await expect(dialog.getByRole('region', { name: '往來' })).toHaveCount(0);

    // 先取消整組，確認交易回到未搬清單且伺服器重新計算全部影響。
    await dialog.getByRole('button', { name: '取消搬移到 家用' }).click();
    await expect(dialog.getByRole('region', { name: '搬移' })).toHaveCount(0);
    await expect(accountRows).toHaveCount(3);
    await expect(dialog.getByRole('region', { name: '往來' })).toContainText('阿德');

    await dialog.getByRole('button', { name: '搬到其他帳本 ›' }).click();
    await completeMove(page, ['存入', '借給阿德'], HOUSEHOLD_LEDGER_NAME);

    // 修改同一組的目標帳本，再改回家用，驗證「修改」會保留已選交易並更新分組。
    await dialog.getByRole('button', { name: '修改搬移到 家用' }).click();
    const editPicker = page.getByRole('dialog', { name: '選擇交易' });
    await expect(editPicker.getByRole('checkbox', { name: '存入' })).toBeChecked();
    await expect(editPicker.getByRole('checkbox', { name: '借給阿德' })).toBeChecked();
    await editPicker.getByRole('button', { name: '下一步', exact: true }).click();
    const editTarget = page.getByRole('dialog', { name: '搬到' });
    await editTarget.getByRole('radio', { name: DAILY_LEDGER_NAME }).check();
    await editTarget.getByRole('button', { name: '完成', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '搬移' })).toContainText('日常');

    await dialog.getByRole('button', { name: '修改搬移到 日常' }).click();
    const secondEditPicker = page.getByRole('dialog', { name: '選擇交易' });
    await expect(secondEditPicker.getByRole('checkbox', { name: '存入' })).toBeChecked();
    await expect(secondEditPicker.getByRole('checkbox', { name: '借給阿德' })).toBeChecked();
    await secondEditPicker.getByRole('button', { name: '下一步', exact: true }).click();
    const secondEditTarget = page.getByRole('dialog', { name: '搬到' });
    await secondEditTarget.getByRole('radio', { name: HOUSEHOLD_LEDGER_NAME }).check();
    await secondEditTarget.getByRole('button', { name: '完成', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '搬移' })).toContainText('家用');

    await dialog.getByRole('button', { name: '搬到其他帳本 ›' }).click();
    const finalPicker = page.getByRole('dialog', { name: '選擇交易' });
    await expect(finalPicker.getByRole('checkbox', { name: '機票訂金' })).toBeVisible();
    await expect(finalPicker.getByRole('checkbox', { name: '存入' })).toHaveCount(0);
    await expect(finalPicker.getByRole('checkbox', { name: '借給阿德' })).toHaveCount(0);
    await finalPicker.getByRole('checkbox', { name: '機票訂金' }).check();
    await finalPicker.getByRole('button', { name: '下一步', exact: true }).click();
    const finalTarget = page.getByRole('dialog', { name: '搬到' });
    const usedHousehold = finalTarget.getByRole('radio', { name: HOUSEHOLD_LEDGER_NAME });
    await expect(usedHousehold).toBeDisabled();
    await expect(finalTarget.getByText('已選', { exact: true })).toBeVisible();
    await finalTarget.getByRole('radio', { name: DAILY_LEDGER_NAME }).check();
    await finalTarget.getByRole('button', { name: '完成', exact: true }).click();

    const completedMoveSection = dialog.getByRole('region', { name: '搬移' });
    await expect(completedMoveSection.getByRole('listitem')).toHaveCount(2);
    await expect(completedMoveSection).toContainText(HOUSEHOLD_LEDGER_NAME);
    await expect(completedMoveSection).toContainText(DAILY_LEDGER_NAME);
    await expect(dialog.getByRole('button', { name: '搬到其他帳本 ›' })).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: '帳戶' })).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: '往來' })).toHaveCount(0);
    const deleteButton = dialog.getByRole('button', { name: '刪除', exact: true });
    await dialog.getByLabel('輸入帳本名稱').fill(TRAVEL_LEDGER_NAME);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(page).toHaveURL(/\/ledgers$/);

    const householdTransactions = (
      await listLedgerTransactions(request, userA.token, householdLedger.id)
    ).items;
    const dailyTransactions = (await listLedgerTransactions(request, userA.token, dailyLedger.id))
      .items;
    expect(householdTransactions.map((transaction) => transaction.id)).toContain(transfer.id);
    expect(householdTransactions.map((transaction) => transaction.id)).toContain(debtTransactionId);
    expect(dailyTransactions.map((transaction) => transaction.id)).toContain(planeDeposit.id);
    await expect
      .poll(async () =>
        (await listAccounts(request, userA.token))
          .map(({ id, balance }) => ({ id, balance }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      )
      .toEqual(balancesBefore);
    await expect
      .poll(async () =>
        (await listAccounts(request, xiaomei.token))
          .map(({ id, balance }) => ({ id, balance }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      )
      .toEqual(xiaomeiBalancesBefore);

    const xiaomeiPage = await openAs(xiaomei);
    await switchLedger(xiaomeiPage, HOUSEHOLD_LEDGER_NAME);
    await openTransactions(xiaomeiPage);
    await expect(transactionRow(xiaomeiPage, '存入')).toBeVisible();
    await expect(transactionRow(xiaomeiPage, '借給阿德')).toBeVisible();
    const xiaomeiLoan = (
      await listLedgerTransactions(request, xiaomei.token, householdLedger.id)
    ).items.find((transaction) => transaction.id === debtTransactionId);
    expect(xiaomeiLoan?.debt).toBeNull();
  });

  test('SC-N8：複製早餐到今天，並可複製到家用的同名分類', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const dailyLedger = await createLedger(request, userA.token, {
      name: DAILY_LEDGER_NAME,
      kind: 'PERSONAL',
    });
    const householdLedger = await createLedger(request, userA.token, {
      name: HOUSEHOLD_LEDGER_NAME,
      kind: 'SHARED',
    });
    const cash = (await listAccounts(request, userA.token)).find(
      (account) => account.name === '現金' && !account.isTemporary,
    );
    const dailyMeal = (await listCategories(request, userA.token, dailyLedger.id)).find(
      (category) => category.name === '餐飲' && category.type === 'EXPENSE',
    );
    const householdMeal = (await listCategories(request, userA.token, householdLedger.id)).find(
      (category) => category.name === '餐飲' && category.type === 'EXPENSE',
    );
    if (!cash || !dailyMeal || !householdMeal) {
      throw new Error('建立早餐前置資料時找不到現金帳戶或同名餐飲分類。');
    }

    const breakfast = await createTransaction(request, userA.token, dailyLedger.id, {
      type: 'EXPENSE',
      amount: 8_000,
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      title: '早餐',
      categoryId: dailyMeal.id,
      accountId: cash.id,
    });

    await page.goto('/');
    await switchLedger(page, DAILY_LEDGER_NAME);
    await openTransactions(page);
    const breakfastRow = transactionRow(page, '早餐');
    await expect(breakfastRow).toBeVisible();
    await breakfastRow.getByRole('button', { name: /更多交易動作/ }).click();
    await page.getByRole('menuitem', { name: '複製', exact: true }).click();

    const today = await browserDate(page);
    const firstCopyForm = page.getByRole('group', { name: '新增一筆交易' });
    await expect(firstCopyForm.getByLabel('日期')).toHaveValue(today);
    await expect(firstCopyForm.getByLabel('名稱')).toHaveValue('早餐');
    await expect(firstCopyForm.getByLabel('金額')).toHaveValue('80');
    await expect(firstCopyForm.getByRole('combobox', { name: '分類' })).toHaveAttribute(
      'aria-valuetext',
      '餐飲',
    );
    await firstCopyForm.getByRole('button', { name: '新增', exact: true }).click();

    await expect
      .poll(
        async () =>
          (await listLedgerTransactions(request, userA.token, dailyLedger.id)).items.filter(
            (transaction) => transaction.title === '早餐',
          ).length,
      )
      .toBe(2);
    const dailyTransactions = (await listLedgerTransactions(request, userA.token, dailyLedger.id))
      .items;
    const firstCopy = dailyTransactions.find((transaction) => transaction.id !== breakfast.id);
    expect(firstCopy).toBeDefined();
    expect(firstCopy?.title).toBe('早餐');
    expect(firstCopy?.amount).toBe(8_000);
    expect(firstCopy?.category?.id).toBe(dailyMeal.id);
    expect(await browserDate(page, firstCopy!.date)).toBe(today);

    const newestBreakfastRow = transactionRow(page, '早餐').first();
    await newestBreakfastRow.getByRole('button', { name: /更多交易動作/ }).click();
    await page.getByRole('menuitem', { name: '複製', exact: true }).click();
    const secondCopyForm = page.getByRole('group', { name: '新增一筆交易' });
    await secondCopyForm.getByLabel('帳本').selectOption({ label: HOUSEHOLD_LEDGER_NAME });
    await expect(secondCopyForm.getByRole('combobox', { name: '分類' })).toHaveAttribute(
      'aria-valuetext',
      householdMeal.name,
    );
    await expect(secondCopyForm.getByLabel('日期')).toHaveValue(today);
    await expect(secondCopyForm.getByLabel('名稱')).toHaveValue('早餐');
    await secondCopyForm.getByRole('button', { name: '新增', exact: true }).click();

    await expect
      .poll(
        async () =>
          (await listLedgerTransactions(request, userA.token, householdLedger.id)).items.filter(
            (transaction) => transaction.title === '早餐',
          ).length,
      )
      .toBe(1);
    const householdCopy = (
      await listLedgerTransactions(request, userA.token, householdLedger.id)
    ).items.find((transaction) => transaction.title === '早餐');
    expect(householdCopy).toBeDefined();
    expect(householdCopy?.id).not.toBe(breakfast.id);
    expect(householdCopy?.amount).toBe(8_000);
    expect(householdCopy?.category?.id).toBe(householdMeal.id);
    expect(await browserDate(page, householdCopy!.date)).toBe(today);

    await switchLedger(page, HOUSEHOLD_LEDGER_NAME);
    await expect(transactionRow(page, '早餐')).toBeVisible();
  });

  test('W199-W200：標註列有色條、首頁跨帳本顯示並可取消，小美看不到色條', async ({
    signedInPage: page,
    userA,
    request,
    openAs,
  }) => {
    await createLedger(request, userA.token, {
      name: DAILY_LEDGER_NAME,
      kind: 'PERSONAL',
    });
    const householdLedger = await createLedger(request, userA.token, {
      name: HOUSEHOLD_LEDGER_NAME,
      kind: 'SHARED',
    });
    const xiaomei = await registerUser(request, 'xiaomei@example.com', '小美');
    await addMember(request, userA.token, householdLedger.id, {
      email: xiaomei.email,
      role: 'EDITOR',
    });

    const cash = (await listAccounts(request, userA.token)).find(
      (account) => account.name === '現金' && !account.isTemporary,
    );
    const taxiCategory = (await listCategories(request, userA.token, householdLedger.id)).find(
      (category) => category.name === '交通' && category.type === 'EXPENSE',
    );
    if (!cash || !taxiCategory) {
      throw new Error('建立計程車前置資料時找不到現金帳戶或交通分類。');
    }
    const taxi = await createTransaction(request, userA.token, householdLedger.id, {
      type: 'EXPENSE',
      amount: 30_000,
      date: new Date().toISOString(),
      title: '計程車',
      categoryId: taxiCategory.id,
      accountId: cash.id,
    });

    await page.goto('/');
    await switchLedger(page, HOUSEHOLD_LEDGER_NAME);
    await openTransactions(page);
    const taxiRow = transactionRow(page, '計程車');
    await expect(taxiRow).toBeVisible();
    await taxiRow.getByRole('button', { name: /更多交易動作/ }).click();
    await page.getByRole('menuitem', { name: '標註', exact: true }).click();
    await expect
      .poll(async () => taxiRow.evaluate((row) => getComputedStyle(row).boxShadow))
      .not.toBe('none');
    const markedTaxi = (
      await listLedgerTransactions(request, userA.token, householdLedger.id)
    ).items.find((transaction) => transaction.id === taxi.id);
    expect(markedTaxi?.marked).toBe(true);

    await switchLedger(page, DAILY_LEDGER_NAME);
    await openDashboard(page);
    const markedCard = page.getByRole('region', { name: '標註' });
    const markedTaxiRow = markedCard.getByRole('listitem').filter({ hasText: '計程車' });
    await expect(markedTaxiRow).toContainText(HOUSEHOLD_LEDGER_NAME);
    await markedTaxiRow.getByRole('button', { name: /更多交易動作/ }).click();
    await page.getByRole('menuitem', { name: '取消標註', exact: true }).click();
    await expect(page.getByRole('region', { name: '標註' })).toHaveCount(0);

    const xiaomeiPage = await openAs(xiaomei);
    await switchLedger(xiaomeiPage, HOUSEHOLD_LEDGER_NAME);
    await openTransactions(xiaomeiPage);
    const xiaomeiTaxiRow = transactionRow(xiaomeiPage, '計程車');
    await expect(xiaomeiTaxiRow).toBeVisible();
    await expect
      .poll(async () => xiaomeiTaxiRow.evaluate((row) => getComputedStyle(row).boxShadow))
      .toBe('none');
    const xiaomeiTaxi = (
      await listLedgerTransactions(request, xiaomei.token, householdLedger.id)
    ).items.find((transaction) => transaction.id === taxi.id);
    expect(xiaomeiTaxi?.marked).toBe(false);
  });
});

/** 把選定項目送到目標帳本；呼叫前選擇交易對話框已經開啟。 */
async function completeMove(page: Page, itemNames: string[], ledgerName: string): Promise<void> {
  const picker = page.getByRole('dialog', { name: '選擇交易' });
  for (const itemName of itemNames) {
    await picker.getByRole('checkbox', { name: itemName }).check();
  }
  await picker.getByRole('button', { name: '下一步', exact: true }).click();

  const target = page.getByRole('dialog', { name: '搬到' });
  await target.getByRole('radio', { name: ledgerName }).check();
  await target.getByRole('button', { name: '完成', exact: true }).click();
  await expect(target).toBeHidden();
}

/** 以瀏覽器本地時區比對表單日期與 API 回傳的日期。 */
async function browserDate(page: Page, value: string | null = null): Promise<string> {
  return page.evaluate((isoDate) => {
    const date = isoDate === null ? new Date() : new Date(isoDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, value);
}
