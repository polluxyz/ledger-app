import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { listAccounts, listCategories, createLedger, addMember } from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  newTransactionForm,
  openDebtsTab,
  openNewTransaction,
  openTransactions,
  selectCategory,
  switchLedger,
  transactionRow,
} from './ui';

async function cashAccount(request: APIRequestContext, token: string) {
  const account = (await listAccounts(request, token)).find((item) => item.name === '現金');
  if (!account) {
    throw new Error('找不到現金帳戶。');
  }
  return account;
}

function temporaryAccountRow(page: Page): Locator {
  return page.getByRole('listitem').filter({ hasText: '臨時帳戶' });
}

/**
 * 驗證共享分帳的每筆交易都落在帳戶：用畫面記分帳、由本人把臨時帳戶換到現金並結清，
 * 再用 API 核對兩位成員的餘額（3e SC-W100、3h SC-H8）。前置帳本與成員透過真實 API 建立。
 */
test('SC-W100：共享帳本分帳、補帳戶與結清主線', async ({
  signedInPage: pageA,
  userA,
  userB,
  openAs,
  request,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: '花蓮旅遊',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });

  const [aCashBefore, bCashBefore] = await Promise.all([
    cashAccount(request, userA.token),
    cashAccount(request, userB.token),
  ]);
  const expense = (await listCategories(request, userA.token, ledger.id)).find(
    (category) => category.type === 'EXPENSE',
  );
  if (!expense) {
    throw new Error('共享帳本找不到支出分類。');
  }
  const today = new Date().toISOString().slice(0, 10);

  await pageA.reload();
  await switchLedger(pageA, ledger.name);
  await openTransactions(pageA);
  await openNewTransaction(pageA);

  const lodgingForm = newTransactionForm(pageA);
  await lodgingForm.getByLabel('金額').fill('6000');
  await lodgingForm.getByLabel('日期').fill(today);
  await selectCategory(lodgingForm, expense.name);
  await lodgingForm.getByLabel('名稱').fill('住宿');
  await lodgingForm.getByLabel('帳戶').selectOption(aCashBefore.id);

  const lodgingSplit = lodgingForm.getByRole('region', { name: '分帳' });
  await expect(lodgingForm.getByRole('checkbox', { name: '分帳' })).toBeChecked();
  await expect(lodgingSplit.getByRole('checkbox', { name: '我' })).toBeChecked();
  await expect(lodgingSplit.getByRole('checkbox', { name: '乙' })).toBeChecked();
  await expect(lodgingSplit.getByRole('listitem').filter({ hasText: '我' })).toContainText(
    '$3,000',
  );
  await expect(lodgingSplit.getByRole('listitem').filter({ hasText: '乙' })).toContainText(
    '$3,000',
  );
  await lodgingForm.getByRole('button', { name: '新增', exact: true }).click();

  const lodgingRow = transactionRow(pageA, '住宿');
  await expect(lodgingRow).toBeVisible();
  await expect(lodgingRow).toContainText('-$6,000');
  await expect(lodgingRow).toContainText('分帳');
  expect((await cashAccount(request, userA.token)).balance).toBe(aCashBefore.balance - 600_000);

  await openNewTransaction(pageA);
  const dinnerForm = newTransactionForm(pageA);
  await dinnerForm.getByLabel('金額').fill('1500');
  await dinnerForm.getByLabel('日期').fill(today);
  await selectCategory(dinnerForm, expense.name);
  await dinnerForm.getByLabel('名稱').fill('晚餐');
  await dinnerForm.getByRole('button', { name: '改為選付款人' }).click();
  const payer = dinnerForm.getByRole('combobox', { name: '付款人' });
  await payer.fill('乙');
  await dinnerForm.getByRole('option', { name: '乙', exact: true }).click();
  await expect(dinnerForm.getByRole('combobox', { name: '帳戶' })).toHaveCount(0);

  const dinnerSplit = dinnerForm.getByRole('region', { name: '分帳' });
  await expect(dinnerForm.getByRole('checkbox', { name: '分帳' })).toBeChecked();
  await expect(dinnerSplit.getByRole('checkbox', { name: '我' })).toBeChecked();
  await expect(dinnerSplit.getByRole('checkbox', { name: '乙' })).toBeChecked();
  await expect(dinnerSplit.getByRole('listitem').filter({ hasText: '我' })).toContainText('$750');
  await expect(dinnerSplit.getByRole('listitem').filter({ hasText: '乙' })).toContainText('$750');
  await dinnerForm.getByRole('button', { name: '新增', exact: true }).click();

  const dinnerRowA = transactionRow(pageA, '晚餐');
  await expect(dinnerRowA).toBeVisible();
  await expect(dinnerRowA).toContainText('-$1,500');
  await expect(dinnerRowA).toContainText('乙付');
  expect((await cashAccount(request, userA.token)).balance).toBe(aCashBefore.balance - 600_000);

  const pageB = await openAs(userB);
  await switchLedger(pageB, ledger.name);
  await openTransactions(pageB);
  const dinnerRowB = transactionRow(pageB, '晚餐');
  await expect(dinnerRowB.getByRole('button', { name: '臨時帳戶' })).toBeVisible();
  await dinnerRowB.getByRole('button', { name: '臨時帳戶' }).click();

  const bFillDialog = pageB.getByRole('dialog', { name: '補帳戶' });
  await expect(bFillDialog.getByRole('combobox')).toHaveCount(1);
  await bFillDialog.getByLabel('帳戶').selectOption(bCashBefore.id);
  const bAccountResponse = pageB.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/account'),
  );
  await bFillDialog.getByRole('button', { name: '儲存', exact: true }).click();
  expect((await bAccountResponse).ok()).toBe(true);
  // 等後端回應再查餘額，避免把尚未完成的儲存誤判成沒有更新。
  expect((await cashAccount(request, userB.token)).balance).toBe(bCashBefore.balance - 150_000);

  // 3g：借還 › 共享（W149～W150）。共享分頁只列轉帳，不列淨額（W158），所以這裡驗的是轉帳方塊。
  await openDebtsTab(pageB, '共享');
  const sharedCard = pageB.getByRole('region', { name: ledger.name });
  // 一本帳本一張卡片，一筆轉帳一個方塊（W159）。方塊的無障礙名稱就是那句話。
  // 乙（我）付給甲 2,250：從乙的視角，是「我欠甲」。
  const transfer = sharedCard.getByRole('button', { name: '我欠甲 $2,250', exact: true });
  await expect(sharedCard.getByRole('listitem')).toHaveCount(1);
  await transfer.click();

  // 點了方塊，預填的結清表單在那一排下方展開（W159）。表單的範圍就是這張卡片。
  await expect(transfer).toHaveAttribute('aria-expanded', 'true');
  const settlementForm = sharedCard;
  const payerOption = settlementForm
    .getByLabel('付錢的人')
    .getByRole('option', { name: '我', exact: true });
  const receiverOption = settlementForm
    .getByLabel('收錢的人')
    .getByRole('option', { name: '甲', exact: true });
  await expect(settlementForm.getByLabel('付錢的人')).toHaveValue(
    (await payerOption.getAttribute('value')) ?? '',
  );
  await expect(settlementForm.getByLabel('收錢的人')).toHaveValue(
    (await receiverOption.getAttribute('value')) ?? '',
  );
  await expect(settlementForm.getByLabel('金額')).toHaveValue('2250');
  await settlementForm.getByLabel('帳戶').selectOption(bCashBefore.id);
  const settlementResponse = pageB.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/ledgers/${ledger.id}/settlements`),
  );
  await settlementForm.getByRole('button', { name: '新增', exact: true }).click();
  expect((await settlementResponse).ok()).toBe(true);
  expect((await cashAccount(request, userB.token)).balance).toBe(bCashBefore.balance - 375_000);

  await pageA.reload();
  await switchLedger(pageA, ledger.name);
  await openTransactions(pageA);
  const settlementRow = temporaryAccountRow(pageA);
  await expect(settlementRow).toHaveCount(1);
  await expect(settlementRow).toContainText('乙');
  await settlementRow.getByRole('button', { name: '臨時帳戶' }).click();

  const aFillDialog = pageA.getByRole('dialog', { name: '補帳戶' });
  await expect(aFillDialog.getByRole('combobox')).toHaveCount(1);
  await aFillDialog.getByLabel('帳戶').selectOption(aCashBefore.id);
  const aAccountResponse = pageA.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/account'),
  );
  await aFillDialog.getByRole('button', { name: '儲存', exact: true }).click();
  expect((await aAccountResponse).ok()).toBe(true);
  expect((await cashAccount(request, userA.token)).balance).toBe(aCashBefore.balance - 375_000);
  expect((await cashAccount(request, userB.token)).balance).toBe(bCashBefore.balance - 375_000);

  // 結清之後共享分頁沒有轉帳了，只剩「兩清」（W158）。
  await openDebtsTab(pageA, '共享');
  await expect(pageA.getByRole('region', { name: '轉帳' })).toHaveCount(0);
  await expect(pageA.getByText('兩清', { exact: true })).toBeVisible();
});
