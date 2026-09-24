import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { listAccounts } from './api';
import { expect, test } from './fixtures';
import { newTransactionForm, openNewTransaction, openTransactions, transactionRow } from './ui';

/**
 * 3b-1 借還畫面（往來帳版）的端對端流程（`docs/specs/phase-3b1-web.md` §5）。
 *
 * 元件測試把 API 整個 mock 掉，證不出兩件最要緊的事：**帳戶餘額真的跟著變**，以及
 * **往來餘額、結清差額、`balanceAfter` 真的是後端算的**。這裡走真的後端，一條主線依序驗
 * SC-W20 → W26，另一條驗代付（SC-W23）與右側欄保留（SC-W27）。
 *
 * 餘額一律用 API 讀：交易頁上沒有帳戶餘額，繞去首頁會整頁重載、清掉快取，反而驗不到畫面的更新。
 */

async function cash(request: APIRequestContext, token: string): Promise<number> {
  const accounts = await listAccounts(request, token);
  return accounts.find((account) => account.name === '現金')!.balance;
}

/** 打開新增表單並切到「借還」分頁。 */
async function openDebtTab(page: Page): Promise<Locator> {
  await openNewTransaction(page);
  const form = newTransactionForm(page);
  await form.getByRole('button', { name: '借還', exact: true }).click();
  return form;
}

/** 在借還分頁填一筆（不送出）。帳戶一律明確選「現金」——帳戶欄沒有預選（SC-W28）。 */
async function fill(
  form: Locator,
  name: string,
  kind: string,
  amount: number,
  options: { account?: string; settle?: boolean } = {},
) {
  await form.getByLabel('對象').fill(name);
  await form.getByRole('group', { name: '往來種類' }).getByRole('button', { name: kind }).click();
  await form.getByLabel('金額').fill(String(amount));
  if (options.account !== undefined) {
    await form.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: options.account });
  }
  if (options.settle) {
    await form.getByLabel('以此結清').check();
  }
}

function viewSwitch(page: Page): Locator {
  return page.getByRole('group', { name: '檢視' });
}

function ledgerPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: '借還往來' });
}

test('往來帳主線：借出、借入抵銷、以此結清、從明細打開往來帳、刪除與免除、修改', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const before = await cash(request, userA.token);
  await openTransactions(page);
  const form = await openDebtTab(page);

  // SC-W20、SC-W28：借出 120。帳戶沒選之前不能送出。
  await fill(form, '小明', '借出', 120);
  await expect(form.getByText('新對象，送出時建立')).toBeVisible();
  await expect(form.getByRole('button', { name: '新增' })).toBeDisabled();
  await form.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await expect(form.getByText('記完後：小明欠你 $120')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();

  await expect.poll(() => cash(request, userA.token)).toBe(before - 120);
  await expect(transactionRow(page, '借出 · 小明')).toBeVisible();

  // SC-W21：同一個人借入 111，送出前先看到目前餘額與記完後的餘額。對象與種類在成功後保留。
  await form.getByLabel('對象').fill('小明');
  await expect(form.getByText('目前小明欠你 $120')).toBeVisible();
  await fill(form, '小明', '借入', 111, { account: '現金' });
  await expect(form.getByText('記完後：小明欠你 $9')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before - 9);

  // SC-W22：對方還我 5 並以此結清 → 差 4 元算了。
  await fill(form, '小明', '對方還我', 5, { account: '現金', settle: true });
  await expect(form.getByText('記完後兩清，差額 −4（少收 4 元）')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before - 4);

  // SC-W27：表單開著時切換檢視，右側欄不收起、對象欄的值還在。
  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  await expect(newTransactionForm(page).getByLabel('對象')).toHaveValue('小明');
  // 右側欄關著時內容仍在 DOM 裡、只是 inert，所以要直接驗 inert，不能只看欄位還在。
  expect(
    await newTransactionForm(page).evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(false);
  await expect(page.getByRole('button', { name: /小明.*兩清/ })).toBeVisible();

  // SC-W24：回到明細，點「借出 · 小明」→ 打開小明的往來帳，balanceAfter 新到舊是 0、4、9、120。
  await viewSwitch(page).getByRole('button', { name: '明細' }).click();
  await transactionRow(page, '借出 · 小明').click();
  const panel = ledgerPanel(page);
  await expect(panel.getByText('兩清', { exact: true })).toBeVisible();
  const balances = panel.getByText(/^餘額 /);
  await expect(balances).toHaveText(['餘額 $0', '餘額 $4', '餘額 $9', '餘額 $120']);

  // SC-W25：刪掉結清差額 → 欠我 4；免除 → 兩清；刪掉免除 → 回到欠我 4。
  const settlementRow = panel.getByRole('listitem').filter({ hasText: '結清差額' });
  await settlementRow.getByRole('button', { name: /刪除/ }).click();
  await page.getByRole('dialog', { name: /刪除/ }).getByRole('button', { name: '刪除' }).click();
  await expect(panel.getByText('小明欠你 $4')).toBeVisible();

  await panel.getByRole('button', { name: '免除剩餘' }).click();
  await page
    .getByRole('dialog', { name: '免除剩餘' })
    .getByRole('button', { name: /免除/ })
    .click();
  await expect(panel.getByText('兩清', { exact: true })).toBeVisible();

  const forgiveRow = panel.getByRole('listitem').filter({ hasText: '免除' });
  await forgiveRow.getByRole('button', { name: /刪除/ }).click();
  await page.getByRole('dialog', { name: /刪除/ }).getByRole('button', { name: '刪除' }).click();
  await expect(panel.getByText('小明欠你 $4')).toBeVisible();

  // SC-W26：把借出 120 改成 150 → 現金再少 30，往來餘額跟著變。
  const lendRow = panel.getByRole('listitem').filter({ hasText: '借出' });
  await lendRow.getByRole('button', { name: /修改/ }).click();
  const editDialog = page.getByRole('dialog', { name: /修改/ });
  await editDialog.getByLabel('金額').fill('150');
  await editDialog.getByRole('button', { name: /儲存/ }).click();
  await expect(panel.getByText('小明欠你 $34')).toBeVisible();
  await expect.poll(() => cash(request, userA.token)).toBe(before - 34);
});

test('對方幫我付：記成我的支出、不扣帳戶、明細看得到代付的人', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const before = await cash(request, userA.token);
  await openTransactions(page);
  const form = await openDebtTab(page);

  // SC-W23
  await fill(form, '小華', '對方幫我付', 400);
  await expect(form.getByRole('combobox', { name: /帳戶/ })).toHaveCount(0);
  await form.getByLabel('分類').selectOption({ index: 1 });
  await expect(form.getByText('記完後：你欠小華 $400')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();

  await expect(transactionRow(page, '小華代付')).toBeVisible();
  expect(await cash(request, userA.token)).toBe(before);

  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  await expect(page.getByRole('button', { name: /小華.*我欠 \$400/ })).toBeVisible();

  // 換到別的頁面再回來，右側欄照 2i 的規則是關的（SC-W27 後半、SC-44）。
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '帳戶' })
    .click();
  await openTransactions(page);
  // 右側欄關著時內容仍留在 DOM，只是被標成 inert（與 layout.spec.ts 的 SC-44 同一種判斷）。
  await expect
    .poll(() => newTransactionForm(page).evaluate((element) => element.closest('[inert]') !== null))
    .toBe(true);
});
