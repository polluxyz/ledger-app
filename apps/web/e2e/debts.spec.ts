import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { createDebtEntry, listAccounts } from './api';
import { expect, test } from './fixtures';
import {
  collapseDebtRow,
  debtEntry,
  debtRow,
  entryMenu,
  expandDebtRow,
  expectRightPanelClosedWithoutAddForm,
  newTransactionForm,
  openDebtsTab,
  openNewTransaction,
  openTransactions,
  transactionRow,
  typeCounterparty,
  undoEntry,
} from './ui';

/**
 * 3b-1 借還畫面（往來帳版）的端對端流程（`docs/specs/phase-3b1-web.md` §5）。
 *
 * 元件測試把 API 整個 mock 掉，證不出兩件最要緊的事：**帳戶餘額真的跟著變**，以及
 * **往來餘額、還款分支、`balanceAfter` 真的是後端算的**。這裡走真的後端，一條主線依序驗
 * SC-W20 → W26，另一條驗修訂 1 的還款（SC-W31～W34）與右側欄保留（SC-W27）。
 * 「對方幫我付」已從畫面拿掉（W20），代付的顯示改由元件測試驗。
 *
 * ## 3g 改了什麼（`docs/specs/phase-3g-debts-inline.md`）
 *
 * 往來帳不再開右側欄，點一列就在那一列下方展開（W153）。原本「打開往來帳、看餘額表、點刪除」
 * 的步驟改成「切到借還的子分頁、展開那一列、在列上操作」，意圖不變。已還清的紀錄移到歷史（決策
 * 153），所以原本在同一張表裡一路看下去的步驟，改成「個人分頁看未還清、歷史看已還清」。
 *
 * ## 3h 更新
 *
 * 借還表單都明確選帳本與真正帳戶；以此結清在還款下呈現分支，撤銷還款時分支一起消失。
 * API 前置往來也透過測試 helper 綁到有效帳本與帳戶。
 *
 * 餘額一律用 API 讀：交易頁上沒有帳戶餘額，繞去首頁會整頁重載、清掉快取，反而驗不到畫面的更新。
 */

/** 現金餘額，單位：分（3c-0）。畫面上輸入的是元，比較時要乘 100。 */
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

/** 在借還分頁填一筆（不送出）；帳本與帳戶由呼叫端明確選定（3h）。 */
async function fill(
  form: Locator,
  name: string,
  kind: string,
  amount: number,
  options: { ledger?: string; account?: string; settle?: boolean } = {},
) {
  await typeCounterparty(form, name);
  await form.getByRole('group', { name: '往來種類' }).getByRole('button', { name: kind }).click();
  await form.getByLabel('金額').fill(String(amount));
  if (options.ledger !== undefined) {
    await form.getByLabel('記在哪本帳本').selectOption({ label: options.ledger });
  }
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

test('往來帳主線：借出、借入抵銷、以此結清、撤銷還款、免除、修改', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const before = await cash(request, userA.token);
  await openTransactions(page);
  const form = await openDebtTab(page);

  // 3h：新帳號沒有最近一次預設時，借出必須同時選帳本與帳戶才能送出。
  await fill(form, '小明', '借出', 120);
  await expect(form.getByText('新對象，送出時建立')).toBeVisible();
  await expect(form.getByLabel('記在哪本帳本')).toHaveValue('');
  await expect(form.getByRole('button', { name: '新增' })).toBeDisabled();
  await form.getByLabel('記在哪本帳本').selectOption({ label: '甲 的帳本' });
  await expect(form.getByRole('button', { name: '新增' })).toBeDisabled();
  await form.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await expect(form.getByText('記完後：小明欠你 $120')).toHaveCount(1);
  await form.getByRole('button', { name: '新增' }).click();

  await expect.poll(() => cash(request, userA.token)).toBe(before - 12000);
  await expect(transactionRow(page, '借出 · 小明')).toBeVisible();

  // SC-W21：同一個人借入 111，送出前先看到目前餘額與記完後的餘額。對象與種類在成功後保留。
  await typeCounterparty(form, '小明');
  await expect(form.getByText('目前小明欠你 $120')).toHaveCount(1);
  await fill(form, '小明', '借入', 111, { account: '現金' });
  await expect(form.getByText('記完後：小明欠你 $9')).toHaveCount(1);
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before - 900);

  // 3h：實收 5 元以此結清 9 元欠款；還清標記與少收分支在歷史紀錄檢查。
  await fill(form, '小明', '還款', 5, { account: '現金', settle: true });
  await expect(form.getByText('小明還你')).toBeVisible();
  await expect(form.getByText('記完後兩清')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before - 400);

  // SC-W27：表單開著時切換檢視，右側欄不收起、對象欄的值還在。
  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  await expect(
    newTransactionForm(page).getByRole('combobox', { name: '對象', exact: true }),
  ).toHaveValue('小明');
  // 右側欄關著時內容仍在 DOM 裡、只是 inert，所以要直接驗 inert，不能只看欄位還在。
  expect(
    await newTransactionForm(page).evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(false);
  // 3f W136：兩清的對象不列，小明這時不在借還清單上。
  await expect(debtRow(page, /^小明/)).toHaveCount(0);

  // 再補一筆已綁帳戶的借出 100（前置條件，D3）讓小明回到清單，後面才能在借還展開他。
  // 切換檢視會重新拉清單，畫面就看得到。
  await createDebtEntry(request, userA.token, {
    counterparty: { name: '小明' },
    kind: 'LEND',
    amount: 10000,
    date: new Date().toISOString(),
  });

  // SC-W58：明細點借還列直接編輯該筆；收起後改從借還的個人分頁展開小明。
  await viewSwitch(page).getByRole('button', { name: '明細' }).click();
  await transactionRow(page, '借出 · 小明').click();
  const transactionDialog = page.getByRole('dialog', { name: '編輯交易' });
  await expect(transactionDialog.getByText('借出 · 小明')).toBeVisible();
  await expect(transactionDialog.getByLabel('金額')).toHaveValue('120');
  await transactionDialog.getByRole('button', { name: '關閉' }).click();
  await expectRightPanelClosedWithoutAddForm(page);

  // 3g 個人分頁只列未還清的紀錄（決策 153）：欠款在 0 那一刻之後的紀錄才算未還清。
  // 借出 100 是歸零之後的第一筆，所以這裡只有它；前面的借出 120 已經進歷史。
  await openDebtsTab(page, '個人');
  const person = await expandDebtRow(page, /^小明/);
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $100');
  await expect(debtEntry(person, '我借給小明 $100')).toHaveCount(1);
  await expect(debtEntry(person, '我借給小明 $120')).toHaveCount(0);

  // 3h：還清標記在還款上，少收分支縮排顯示且沒有「⋯」。
  // 還款與分支已經歸零、在歷史裡，先到歷史確認。
  await openDebtsTab(page, '歷史');
  const history = await expandDebtRow(page, /^小明/);
  const repayment = debtEntry(history, '小明還我 $9');
  await expect(repayment).toHaveCount(1);
  await expect(repayment).toContainText('還清');
  const difference = repayment.getByLabel(/少收/);
  await expect(difference).toBeVisible();
  await expect(entryMenu(difference)).toHaveCount(0);

  // 撤銷還款：少收分支一起撤銷（3h）。剩下的三筆都未還清，欠我 109。
  await undoEntry(page, repayment);
  await expect(debtRow(page, /^小明/)).toHaveCount(0);

  await openDebtsTab(page, '個人');
  const person109 = await expandDebtRow(page, /^小明/);
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $109');
  await expect(debtEntry(person109, '我借給小明 $120')).toHaveCount(1);
  await expect(person109.getByLabel(/少收/)).toHaveCount(0);

  // 免除剩餘（展開區最下面靠右）：欠款歸零，小明離開個人分頁，之後的紀錄都進歷史。
  await person109.getByRole('button', { name: '免除剩餘', exact: true }).click();
  await page
    .getByRole('dialog', { name: '免除剩餘' })
    .getByRole('button', { name: '免除', exact: true })
    .click();
  await expect(debtRow(page, /^小明/)).toHaveCount(0);

  // 歷史裡的免除也可以撤銷（W162 沿用「⋯」）。撤銷後欠款回到 109，小明回到個人分頁。
  await openDebtsTab(page, '歷史');
  const forgiven = await expandDebtRow(page, /^小明/);
  await undoEntry(page, debtEntry(forgiven, '我免除小明欠我的 $109'));

  await openDebtsTab(page, '個人');
  const personAgain = await expandDebtRow(page, /^小明/);
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $109');

  // SC-W26：把借出 120 改成 150 → 現金再少 30，欠款跟著變。修改在那一筆的「⋯」裡。
  await entryMenu(debtEntry(personAgain, '我借給小明 $120')).click();
  await page.getByRole('menuitem', { name: '修改', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: '修改往來紀錄' });
  await editDialog.getByLabel('金額').fill('150');
  await editDialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $139');
  // 還款已撤銷；現金包含借出 150、借入 111，以及 API 前置借出的 100。
  await expect.poll(() => cash(request, userA.token)).toBe(before - 13_900);
});

test('SC-W67：借還列收起後，右側欄維持收起、不冒出新增表單', async ({ signedInPage: page }) => {
  await openTransactions(page);
  const form = await openDebtTab(page);
  await fill(form, '小明', '借出', 120, { ledger: '甲 的帳本', account: '現金' });
  await form.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('button', { name: '收起新增面板' }).click();

  await openDebtsTab(page, '個人');
  const row = await expandDebtRow(page, /^小明/);
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $120');
  await expect(debtEntry(row, '我借給小明 $120')).toHaveCount(1);

  // 3g 沒有往來帳右側欄，改驗：收起列之後，右側欄仍是收著的（表單標成 inert），沒有被換成別的內容。
  await collapseDebtRow(page, /^小明/);
  expect(
    await newTransactionForm(page).evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(true);
});

test('SC-W68：從明細編輯借出金額後更新明細並收起右側欄', async ({ signedInPage: page }) => {
  await openTransactions(page);
  const form = await openDebtTab(page);
  await fill(form, '小明', '借出', 120, { ledger: '甲 的帳本', account: '現金' });
  await form.getByLabel('備註').fill('原備註');
  await form.getByRole('button', { name: '新增', exact: true }).click();

  const row = transactionRow(page, '借出 · 小明');
  await expect(row).toBeVisible();
  await row.click();

  const dialog = page.getByRole('dialog', { name: '編輯交易' });
  await expect(dialog.getByLabel('金額')).toHaveValue('120');
  await expect(dialog.getByLabel('備註')).toHaveValue('原備註');
  await dialog.getByLabel('金額').fill('180');
  await dialog.getByRole('button', { name: '儲存' }).click();

  await expectRightPanelClosedWithoutAddForm(page);
  await expect(row.getByText('-$180')).toBeVisible();

  // 總覽的展開區只看不操作（W156），金額改了之後那一筆的內容也要跟著變。
  await openDebtsTab(page, '總覽');
  const overview = await expandDebtRow(page, /^小明/);
  await expect(debtRow(page, /^小明/)).toContainText('小明欠你 $180');
  await expect(debtEntry(overview, '我借給小明 $180')).toHaveCount(1);
});

test('還款：沒有欠款不能還、我欠對方時是付錢、超過欠款要結清', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const before = await cash(request, userA.token);
  await openTransactions(page);
  const form = await openDebtTab(page);
  const kinds = form.getByRole('group', { name: '往來種類' });

  // SC-W31：只有 3 個種類。
  await expect(kinds.getByRole('button')).toHaveText(['借出', '借入', '還款']);

  // SC-W33：新對象沒有欠款，還款停用。
  await typeCounterparty(form, '小華');
  await expect(kinds.getByRole('button', { name: '還款' })).toBeDisabled();
  await expect(form.getByText('目前沒有欠款')).toBeVisible();

  // 向小華借 400 → 我欠小華。
  await fill(form, '小華', '借入', 400, { ledger: '甲 的帳本', account: '現金' });
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before + 40000);

  // SC-W32：我欠對方時，還款是「你還小華」、從帳戶付出。
  await fill(form, '小華', '還款', 450);
  await expect(form.getByText('你還小華')).toBeVisible();
  await form.getByRole('combobox', { name: '從哪個帳戶付出' }).selectOption({ label: '現金' });

  // SC-W34／3h：超過欠款又沒勾結清會停用送出；勾了結清後少付 50 元會記成收入分支。
  await expect(form.getByText(/超過欠款 \$50/)).toBeVisible();
  await expect(form.getByRole('button', { name: '新增' })).toBeDisabled();
  await fill(form, '小華', '還款', 350, { settle: true });
  await expect(form.getByText('記完後兩清')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();
  await expect.poll(() => cash(request, userA.token)).toBe(before + 5000);

  await viewSwitch(page).getByRole('button', { name: '借還' }).click();
  // 3f W136：還款結清後兩清的對象不列，小華不在清單上。
  await expect(debtRow(page, /^小華/)).toHaveCount(0);

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
