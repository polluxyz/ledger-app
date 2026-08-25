import {
  createAccount,
  createTransaction,
  listAccounts,
  listCategories,
  personalLedger,
} from './api';
import { expect, test } from './fixtures';
import { newTransactionForm, transactionRow } from './ui';

/**
 * Slice 3 的三個情境（spec §7 的 7～9）。
 *
 * 三條都圍著同一件事：**改動交易之後，帳戶餘額必須跟著變**。餘額是後端算出來的，
 * 前端少做一次快取失效不會拋錯、不會讓任何單元測試變紅，畫面上的數字只會停在舊值。
 * 那種問題只有真的操作一遍才看得到。
 *
 * 前置資料一律用 API 建立（D3）：被測的是編輯、刪除、轉帳，不是「怎麼記第一筆帳」。
 */

/** 今天的日期，符合後端要的 ISO 8601。 */
const TODAY = new Date().toISOString();

test('情境 7：編輯金額後帳戶餘額跟著變', async ({ signedInPage: page, userA, request }) => {
  const ledger = await personalLedger(request, userA.token);
  const [cash] = await listAccounts(request, userA.token);
  const categories = await listCategories(request, userA.token, ledger.id);
  const expense = categories.find((category) => category.type === 'EXPENSE');

  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 120,
    date: TODAY,
    categoryId: expense!.id,
    accountId: cash!.id,
    note: '午餐',
  });

  // fixture 在資料建立之前就開過首頁了，重新載入才看得到這一筆。
  await page.reload();

  await expect(page.getByLabel('現金餘額')).toHaveText('$-120');

  await transactionRow(page, '-$120').getByRole('button', { name: /^編輯/ }).click();

  const dialog = page.getByRole('dialog', { name: '編輯交易' });
  await dialog.getByLabel('金額').fill('200');
  await dialog.getByRole('button', { name: '儲存' }).click();

  // 列表與餘額都要跟著變。只驗其中一個的話，漏掉快取失效仍然會綠。
  await expect(transactionRow(page, '-$200')).toBeVisible();
  await expect(page.getByLabel('現金餘額')).toHaveText('$-200');
});

test('情境 8：刪除後那一筆從列表消失', async ({ signedInPage: page, userA, request }) => {
  const ledger = await personalLedger(request, userA.token);
  const [cash] = await listAccounts(request, userA.token);
  const categories = await listCategories(request, userA.token, ledger.id);
  const expense = categories.find((category) => category.type === 'EXPENSE');

  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 120,
    date: TODAY,
    categoryId: expense!.id,
    accountId: cash!.id,
  });

  await page.reload();
  await expect(page.getByLabel('現金餘額')).toHaveText('$-120');

  await transactionRow(page, '-$120').getByRole('button', { name: /^刪除/ }).click();

  const dialog = page.getByRole('dialog', { name: '刪除交易' });
  await expect(dialog.getByText('刪除後無法復原')).toBeVisible();
  await dialog.getByRole('button', { name: '刪除' }).click();

  // 後端是軟刪除，但對使用者而言它就是不在了——列表與餘額都要反映這件事。
  await expect(page.getByText('還沒有任何交易')).toBeVisible();
  await expect(page.getByLabel('現金餘額')).toHaveText('$0');
});

test('情境 9：轉帳讓兩個帳戶的餘額都變動', async ({ signedInPage: page, userA, request }) => {
  await createAccount(request, userA.token, { name: '國泰世華', initialBalance: 5000 });

  await page.reload();

  const form = newTransactionForm(page);
  await form.getByRole('button', { name: '轉帳' }).click();

  // 轉帳沒有分類，只有兩個帳戶。
  await expect(form.getByLabel('分類')).toHaveCount(0);
  await form.getByLabel('金額').fill('500');
  await form.getByLabel('轉出帳戶').selectOption({ label: '國泰世華' });
  await form.getByLabel('轉入帳戶').selectOption({ label: '現金' });
  await form.getByRole('button', { name: '新增', exact: true }).click();

  // 錢只是換了帳戶：不加正負號，也不屬於任何分類。
  const entry = transactionRow(page, '$500');
  await expect(entry).toContainText('轉帳');
  await expect(entry).toContainText('國泰世華 → 現金');

  await expect(page.getByLabel('國泰世華餘額')).toHaveText('$4,500');
  await expect(page.getByLabel('現金餘額')).toHaveText('$500');
});
