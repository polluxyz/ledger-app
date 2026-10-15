import type { APIRequestContext } from '@playwright/test';
import {
  addMember,
  createDebtEntry,
  createLedger,
  createTransaction,
  listAccounts,
  listCategories,
  listLedgerPeople,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  confirmUndo,
  debtEntry,
  debtRow,
  entryMenu,
  expandDebtRow,
  openDebtsTab,
  undoEntry,
} from './ui';

/**
 * 3g 借還列內展開與 3h 每筆帳戶行為的回歸（`docs/specs/phase-3g-debts-inline.md`、
 * `docs/specs/phase-3h-every-entry-has-account.md`）。真實 API 建立前置資料，畫面完成借還、撤銷與共享結清。
 *
 * 1. **個人**：記一筆借出 → 以此結清少收 → 往來與明細都在還款下顯示分支 → 撤銷還款後分支一起消失、餘額復原。
 * 2. **共享**：共享帳本分帳 → 共享分頁點轉帳方塊，全寬表單預填後送出 → 歷史的共享帳本段出現
 *    這本帳本 → 撤銷結清 → 結清消失、方塊回來（W158～W163）。
 *
 * 前置資料（欠款、共享帳本、分帳支出）一律用 API 建立（D3），被測的動線全部走畫面。
 * 借還表單明確選帳戶；現金餘額用 API 讀，確認每一步都實際進帳戶。
 */

/** 現金餘額，單位：分（3c-0）。 */
async function cash(request: APIRequestContext, token: string): Promise<number> {
  const accounts = await listAccounts(request, token);
  return accounts.find((account) => account.name === '現金')!.balance;
}

test('個人主線：以此結清少收一筆、移到歷史、撤銷還款後分支一起不見', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const before = await cash(request, userA.token);

  // 前置：阿明已經欠我 300（API 建立），他才會出現在個人分頁。
  await createDebtEntry(request, userA.token, {
    counterparty: { name: '阿明' },
    kind: 'LEND',
    amount: 30_000,
    date: new Date().toISOString(),
  });
  await expect.poll(() => cash(request, userA.token)).toBe(before - 30_000);

  // 個人分頁：展開阿明，記一筆借出 700，欠我 1,000，從現金借出（記進帳本與帳戶）。
  await openDebtsTab(page, '個人');
  const row = await expandDebtRow(page, /^阿明/);
  await row.getByRole('button', { name: '記一筆', exact: true }).click();
  await row
    .getByRole('group', { name: '往來種類' })
    .getByRole('button', { name: '借出', exact: true })
    .click();
  await row.getByLabel('金額').fill('700');
  await row.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await row.getByRole('button', { name: '新增', exact: true }).click();
  await expect(debtRow(page, /^阿明/)).toContainText('阿明欠你 $1,000');
  await expect.poll(() => cash(request, userA.token)).toBe(before - 100_000);

  // 以此結清：實收 900、欠款 1,000，少收 100 會成為還款下的分支（3h 決策 170）。
  await row.getByRole('button', { name: '記一筆', exact: true }).click();
  await row
    .getByRole('group', { name: '往來種類' })
    .getByRole('button', { name: '還款', exact: true })
    .click();
  await row.getByLabel('金額').fill('900');
  await row.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await row.getByLabel('以此結清').check();
  await expect(row.getByText('記完後兩清')).toBeVisible();
  await row.getByRole('button', { name: '新增', exact: true }).click();

  // 欠款歸零：阿明離開個人分頁。歸零那一筆與之前的紀錄都進歷史（決策 153）。
  await expect(debtRow(page, /^阿明/)).toHaveCount(0);
  await expect.poll(() => cash(request, userA.token)).toBe(before - 10_000);

  // 歷史的往來紀錄：還款顯示欠款全額，下面的少收分支沒有自己的「⋯」。
  await openDebtsTab(page, '歷史');
  const history = await expandDebtRow(page, /^阿明/);
  const repayment = debtEntry(history, '阿明還我 $1,000');
  await expect(repayment).toHaveCount(1);
  await expect(repayment).toContainText('還清');
  const difference = repayment.getByLabel(/少收/);
  await expect(difference).toBeVisible();
  await expect(entryMenu(difference)).toHaveCount(0);

  // 在歷史撤銷還款：分支在同一個交易裡一起撤銷（3h）。沒有還款也沒有分支了，
  // 剩下的兩筆借出都未還清，阿明整個離開歷史，回到個人分頁、欠我 1,000。
  await undoEntry(page, repayment);
  await expect(debtRow(page, /^阿明/)).toHaveCount(0);

  await openDebtsTab(page, '個人');
  const back = await expandDebtRow(page, /^阿明/);
  await expect(debtRow(page, /^阿明/)).toContainText('阿明欠你 $1,000');
  await expect(back.getByLabel(/少收/)).toHaveCount(0);
  await expect(debtEntry(back, '我借給阿明 $700')).toHaveCount(1);
  await expect(debtEntry(back, '我借給阿明 $300')).toHaveCount(1);
  // 還款與分支一起撤回；API 預置的 300 和畫面借出的 700 都仍在帳戶紀錄裡。
  await expect.poll(() => cash(request, userA.token)).toBe(before - 100_000);
});

test('共享主線：方塊記結清、歷史出現這本帳本、撤銷後結清消失、方塊回來', async ({
  signedInPage: page,
  userA,
  userB,
  request,
}) => {
  // 前置：共享帳本，我付 900 元兩人均分，乙欠我 450。
  const ledger = await createLedger(request, userA.token, {
    name: '花蓮三日',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });
  const people = await listLedgerPeople(request, userA.token, ledger.id);
  const shareIds = [userA, userB].map((user) => {
    const person = people.find((candidate) => candidate.userId === user.id);
    if (!person) {
      throw new Error(`帳本裡找不到 ${user.name} 的 LedgerPerson。`);
    }
    return person.id;
  });
  const expense = (await listCategories(request, userA.token, ledger.id)).find(
    (category) => category.type === 'EXPENSE',
  );
  if (!expense) {
    throw new Error('共享帳本找不到支出分類。');
  }
  const aCash = (await listAccounts(request, userA.token)).find(
    (account) => account.name === '現金',
  );
  if (!aCash) {
    throw new Error('找不到甲的現金帳戶。');
  }
  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 90_000,
    date: new Date().toISOString(),
    categoryId: expense.id,
    accountId: aCash.id,
    ledgerSplit: { method: 'EQUAL', shares: shareIds.map((personId) => ({ personId })) },
  });

  // 共享分頁：花蓮三日一張卡片，乙 ─▶ 我 的方塊。點它，預填的表單在那一排下方全寬展開。
  await openDebtsTab(page, '共享');
  const card = page.getByRole('region', { name: '花蓮三日' });
  const transfer = card.getByRole('button', { name: '乙欠我 $450', exact: true });
  await expect(transfer).toBeVisible();
  await transfer.click();
  await expect(transfer).toHaveAttribute('aria-expanded', 'true');

  // 全寬：表單那一列的寬度明顯大於方塊（方塊是一排兩個中的一個）。
  const formRow = card.getByLabel('金額').locator('xpath=ancestor::li[1]');
  const formBox = await formRow.boundingBox();
  const transferBox = await transfer.boundingBox();
  expect(formBox).not.toBeNull();
  expect(transferBox).not.toBeNull();
  expect(formBox!.width).toBeGreaterThan(transferBox!.width * 1.5);

  // 預填：付錢的人＝乙、收錢的人＝我、金額 450。
  const payer = card.getByLabel('付錢的人');
  await expect(payer).toHaveValue(
    (await payer.getByRole('option', { name: '乙', exact: true }).getAttribute('value')) ?? '',
  );
  const receiver = card.getByLabel('收錢的人');
  await expect(receiver).toHaveValue(
    (await receiver.getByRole('option', { name: '我', exact: true }).getAttribute('value')) ?? '',
  );
  await expect(card.getByLabel('金額')).toHaveValue('450');

  const settlementResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/ledgers/${ledger.id}/settlements`),
  );
  await card.getByRole('button', { name: '新增', exact: true }).click();
  expect((await settlementResponse).ok()).toBe(true);
  // 結清之後這本帳本沒有轉帳了：方塊不見，卡片顯示「兩清」（W158）。
  await expect(transfer).toHaveCount(0);
  await expect(card.getByText('兩清', { exact: true })).toBeVisible();

  // 歷史的共享帳本段：花蓮三日出現，展開看到那筆結清（W161）。
  await openDebtsTab(page, '歷史');
  const ledgerHistory = await expandDebtRow(page, '花蓮三日');
  await expect(ledgerHistory.getByText('$450', { exact: true })).toBeVisible();

  // 撤銷結清（W163）：用同樣的「⋯」→「撤銷」，並確認。
  await ledgerHistory.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '撤銷', exact: true }).click();
  await confirmUndo(page);

  // 這本帳本已經沒有結清，歷史的共享帳本段就不列它了（W161）。
  await expect(debtRow(page, '花蓮三日')).toHaveCount(0);

  // 共享分頁：方塊回來，欠款還在。
  await openDebtsTab(page, '共享');
  await expect(
    page.getByRole('region', { name: '花蓮三日' }).getByRole('button', {
      name: '乙欠我 $450',
      exact: true,
    }),
  ).toBeVisible();
});
