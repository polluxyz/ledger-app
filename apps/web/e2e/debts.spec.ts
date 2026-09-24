import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { createAccount, listAccounts } from './api';
import { expect, test } from './fixtures';
import { newTransactionForm, openNewTransaction, openTransactions, transactionRow } from './ui';

/**
 * 3b-1 借還畫面的端對端流程（`docs/specs/phase-3b1-web.md` §5）。
 *
 * 元件測試把 API 整個 mock 掉，證不出兩件最要緊的事：**帳戶餘額真的跟著變**，以及
 * **結清差額真的是後端算的**。這裡走真的後端，一條主線依序驗 SC-W1 → W2 → W2a → W3
 * → W6 → W8，另一條驗 SC-W5（舊債）。
 *
 * 前置資料只有「LINE Pay」帳戶用 API 建立；借出、還款都從畫面操作，因為那正是被測的東西。
 * 餘額一律用 API 讀：交易頁上沒有餘額，繞去首頁會整頁重載、清掉快取，反而驗不到畫面的更新。
 */

/** 讀某個帳戶目前的餘額。 */
async function balanceOf(request: APIRequestContext, token: string, name: string) {
  const accounts = await listAccounts(request, token);
  const account = accounts.find((candidate) => candidate.name === name);
  if (!account) {
    throw new Error(`找不到帳戶「${name}」`);
  }
  return account.balance;
}

/**
 * 打開新增表單並切到「借還」分頁。
 *
 * 切換「明細／借還」檢視會改網址，右側欄照 2i 的規則在換頁時收起來，所以每次切換
 * 檢視之後都要重新打開（已知問題，見 plan 的實作紀錄）。
 */
async function openDebtTab(page: Page): Promise<Locator> {
  await openNewTransaction(page);
  const form = newTransactionForm(page);
  await form.getByRole('button', { name: '借還', exact: true }).click();
  return form;
}

/** 交易頁上方的「明細／借還」切換。 */
function viewSwitch(page: Page): Locator {
  return page.getByRole('group', { name: '檢視' });
}

/** 右側欄的債務詳情。 */
function debtDetail(page: Page): Locator {
  return page.getByRole('dialog', { name: '借還詳情' });
}

test('借還主線：借出、部分還款、以此結清、從明細打開詳情、刪除', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await createAccount(request, userA.token, { name: 'LINE Pay' });
  const cashBefore = await balanceOf(request, userA.token, '現金');
  const linePayBefore = await balanceOf(request, userA.token, 'LINE Pay');

  await openTransactions(page);

  // SC-W1：借出 5,000，記進現金。
  const form = await openDebtTab(page);
  await form.getByRole('button', { name: '借出', exact: true }).click();
  await form.getByLabel('對方名字').fill('小明');
  await form.getByLabel('金額').fill('5000');
  await form.getByLabel('帳戶').selectOption({ label: '現金' });
  await form.getByRole('button', { name: '新增' }).click();

  await expect.poll(() => balanceOf(request, userA.token, '現金')).toBe(cashBefore - 5000);
  await expect(transactionRow(page, '借出')).toBeVisible();

  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  await expect(page.getByText('欠我 $5,000')).toBeVisible();

  // SC-W2、SC-W2a：還款 2,000，這次走 LINE Pay；帳戶欄沒有預選。
  await openDebtTab(page);
  await form.getByRole('button', { name: '還款', exact: true }).click();
  await form.getByLabel('債務').selectOption({ label: '借給小明 · 剩 $5,000' });
  await expect(form.getByLabel('金額')).toHaveValue('5000');
  await expect(form.getByLabel('收款帳戶')).toHaveValue('');
  await expect(form.getByRole('button', { name: '新增' })).toBeDisabled();

  await form.getByLabel('金額').fill('2000');
  await form.getByLabel('收款帳戶').selectOption({ label: 'LINE Pay' });
  await form.getByRole('button', { name: '新增' }).click();

  await expect.poll(() => balanceOf(request, userA.token, 'LINE Pay')).toBe(linePayBefore + 2000);
  // 借出記在現金、還款走 LINE Pay：現金不受這筆還款影響。
  expect(await balanceOf(request, userA.token, '現金')).toBe(cashBefore - 5000);
  await expect(page.getByText('欠我 $3,000')).toBeVisible();

  // SC-W3：再收 2,990 並勾「以此結清」，差 10 元就算了。
  await form.getByLabel('債務').selectOption({ label: '借給小明 · 剩 $3,000' });
  await form.getByLabel('金額').fill('2990');
  await form.getByLabel('收款帳戶').selectOption({ label: '現金' });
  await form.getByLabel('以此結清').check();
  await expect(form.getByText('差額 -10：對方少還 10 元，這筆借還會結清')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();

  await expect.poll(() => balanceOf(request, userA.token, '現金')).toBe(cashBefore - 5000 + 2990);
  await expect(page.getByText('目前沒有未結清的借還', { exact: true })).toBeVisible();

  // SC-W6：回到明細，點「收回」那一筆，右側欄打開債務詳情；差額取自後端。
  await viewSwitch(page).getByRole('button', { name: '明細' }).click();
  await transactionRow(page, '$2,990').click();
  const detail = debtDetail(page);
  await expect(detail.getByText('借給小明')).toBeVisible();
  await expect(detail.getByText('已結清')).toBeVisible();
  await expect(detail.getByText('結清差額 -10（對方少還）')).toBeVisible();
  // 已結清就沒有「記還款」。
  await expect(detail.getByRole('button', { name: '記還款' })).toHaveCount(0);

  // SC-W8：刪除債務，兩個帳戶都回到借出前。
  await detail.getByRole('button', { name: '刪除', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '刪除借還' });
  await expect(confirm.getByText(/帳戶餘額會回到記這筆借還之前/)).toBeVisible();
  await confirm.getByRole('button', { name: '刪除' }).click();

  await expect.poll(() => balanceOf(request, userA.token, '現金')).toBe(cashBefore);
  expect(await balanceOf(request, userA.token, 'LINE Pay')).toBe(linePayBefore);
  await expect(transactionRow(page, '借出')).toHaveCount(0);
});

test('舊債：不記入帳本，餘額不變，只出現在借還檢視', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const cashBefore = await balanceOf(request, userA.token, '現金');
  await openTransactions(page);

  // SC-W5
  const form = await openDebtTab(page);
  await form.getByRole('button', { name: '借入', exact: true }).click();
  await form.getByLabel('對方名字').fill('阿華');
  await form.getByLabel('金額').fill('1200');
  await form.getByLabel('這是舊債，不記入帳本').check();
  await form.getByRole('button', { name: '新增' }).click();

  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  await expect(page.getByText('我欠 $1,200')).toBeVisible();
  await expect(page.getByText('舊債', { exact: true })).toBeVisible();
  expect(await balanceOf(request, userA.token, '現金')).toBe(cashBefore);

  // SC-W9：重新整理後仍停在借還檢視。
  await page.reload();
  await expect(viewSwitch(page).getByRole('button', { name: '借還' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await viewSwitch(page).getByRole('button', { name: '明細' }).click();
  await expect(transactionRow(page, '借入')).toHaveCount(0);
});
