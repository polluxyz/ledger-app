import type { APIRequestContext } from '@playwright/test';
import {
  addMember,
  createAccount,
  createLedger,
  createTransaction,
  listAccounts,
  listCategories,
  personalLedger,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import { newTransactionForm, switchLedger, transactionFilters, transactionRow } from './ui';

/**
 * Slice 3 的六個情境（spec §7 的 7～12）。
 *
 * 前三條圍著同一件事：**改動交易之後，帳戶餘額必須跟著變**。餘額是後端算出來的，
 * 前端少做一次快取失效不會拋錯、不會讓任何單元測試變紅，畫面上的數字只會停在舊值。
 * 那種問題只有真的操作一遍才看得到。
 *
 * 後三條是篩選、分頁，以及「編輯別人的交易」。最後那條特別值得走真的後端：
 * 帳戶遮蔽是後端做的，元件測試把它 mock 掉了，只有 e2e 證得出「別人的帳戶真的
 * 被遮起來」以及「不帶 accountId 送出時，那筆錢仍然記在他的戶頭」。
 *
 * 前置資料一律用 API 建立（D3）：被測的是編輯、刪除、轉帳，不是「怎麼記第一筆帳」。
 */

/** 今天的日期，符合後端要的 ISO 8601。 */
const TODAY = new Date().toISOString();

/** 個人帳本的第一個支出分類與「現金」帳戶——多數情境的共同前置。 */
async function personalSetup(request: APIRequestContext, token: string) {
  const ledger = await personalLedger(request, token);
  const accounts = await listAccounts(request, token);
  const categories = await listCategories(request, token, ledger.id);
  return {
    ledger,
    cash: accounts[0]!,
    expense: categories.find((category) => category.type === 'EXPENSE')!,
    income: categories.find((category) => category.type === 'INCOME')!,
  };
}

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

test('情境 10：篩選只留下符合條件的交易', async ({ signedInPage: page, userA, request }) => {
  const { ledger, cash, expense, income } = await personalSetup(request, userA.token);

  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 120,
    date: TODAY,
    categoryId: expense.id,
    accountId: cash.id,
  });
  await createTransaction(request, userA.token, ledger.id, {
    type: 'INCOME',
    amount: 5000,
    date: TODAY,
    categoryId: income.id,
    accountId: cash.id,
  });

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(2);

  await transactionFilters(page).getByLabel('型別').selectOption('INCOME');

  // 篩選由後端執行，前端不自行過濾當頁——這裡驗的是查詢真的送出去了。
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(transactionRow(page, '+$5,000')).toBeVisible();

  await transactionFilters(page).getByRole('button', { name: '清除篩選' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

test('情境 11：翻到第 2 頁，改篩選就回到第 1 頁', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const { ledger, cash, expense } = await personalSetup(request, userA.token);

  // 每頁 20 筆，21 筆才有第 2 頁。金額各不相同，好認出翻到哪一頁。
  // 排序是日期新→舊、同日再看建立時間，所以最先建立的那一筆會落在第 2 頁。
  for (let index = 0; index < 21; index += 1) {
    await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 101 + index,
      date: TODAY,
      categoryId: expense.id,
      accountId: cash.id,
    });
  }

  await page.reload();

  const pager = page.getByRole('navigation', { name: '分頁' });
  await expect(pager.getByText('第 1 / 2 頁')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(20);
  await expect(pager.getByRole('button', { name: '上一頁' })).toBeDisabled();

  await pager.getByRole('button', { name: '下一頁' }).click();

  await expect(pager.getByText('第 2 / 2 頁')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(transactionRow(page, '-$101')).toBeVisible();

  // 改條件卻停在第 2 頁的話，使用者會看到一片空白而不知道為什麼。
  await transactionFilters(page).getByLabel('型別').selectOption('EXPENSE');

  await expect(pager.getByText('第 1 / 2 頁')).toBeVisible();
  await expect(transactionRow(page, '-$121')).toBeVisible();
});

test('情境 12：編輯別人的交易時改不到他的帳戶', async ({
  signedInPage: page,
  userA,
  userB,
  request,
}) => {
  const shared = await createLedger(request, userA.token, { name: '家庭開銷', kind: 'SHARED' });
  await addMember(request, userA.token, shared.id, { email: USER_B_EMAIL, role: 'EDITOR' });

  const categories = await listCategories(request, userA.token, shared.id);
  const expense = categories.find((category) => category.type === 'EXPENSE')!;
  const [bCash] = await listAccounts(request, userB.token);

  // 乙用**自己的**帳戶記一筆。甲看得到金額與分類，看不到帳戶（SC-18）。
  await createTransaction(request, userB.token, shared.id, {
    type: 'EXPENSE',
    amount: 120,
    date: TODAY,
    categoryId: expense.id,
    accountId: bCash!.id,
  });

  await page.reload();
  await switchLedger(page, '家庭開銷');

  const row = transactionRow(page, '-$120');
  await expect(row).toBeVisible();
  // 別人的帳戶名稱不該出現在畫面上。
  await expect(row).not.toContainText('現金');

  await row.getByRole('button', { name: /^編輯/ }).click();

  const dialog = page.getByRole('dialog', { name: '編輯交易' });
  await expect(dialog.getByText('這筆記在其他成員的帳戶')).toBeVisible();
  await expect(dialog.getByLabel('帳戶')).toHaveCount(0);
  // 轉出沿用他的帳戶、轉入是我的——後端會接受，但沒有人是那個意思。
  await expect(dialog.getByRole('button', { name: '轉帳' })).toHaveCount(0);

  await dialog.getByLabel('金額').fill('200');
  await dialog.getByRole('button', { name: '儲存' }).click();

  await expect(transactionRow(page, '-$200')).toBeVisible();

  // 這才是重點：錢還是記在乙的戶頭，甲的餘額一毛都沒動。
  const [bCashAfter] = await listAccounts(request, userB.token);
  expect(bCashAfter!.balance).toBe(-200);
  await expect(page.getByLabel('現金餘額')).toHaveText('$0');
});

test('編輯彈窗不會被欄位撐到橫向捲動', async ({ signedInPage: page, userA, request }) => {
  // 彈窗的寬度是固定的（22rem），裡面的欄位必須跟著縮。`<input type="date">` 與
  // `<select>` 都有很寬的預設尺寸，一旦它們不肯縮，整張表單就會超出彈窗，
  // 使用者得左右捲才看得到欄位的右半邊。
  const { ledger, cash, expense } = await personalSetup(request, userA.token);

  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 120,
    date: TODAY,
    categoryId: expense.id,
    accountId: cash.id,
  });

  await page.reload();
  await transactionRow(page, '-$120').getByRole('button', { name: /^編輯/ }).click();

  const dialog = page.getByRole('dialog', { name: '編輯交易' });
  await expect(dialog.getByLabel('金額')).toBeVisible();

  // 捲動寬度大於可視寬度＝內容溢出。留 1px 給次像素誤差。
  const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
