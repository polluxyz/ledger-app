import { listCategories, personalLedger } from './api';
import { expect, test } from './fixtures';
import { newTransactionForm, openNewTransaction } from './ui';

/**
 * Slice 4：分類管理頁（SC-9）。
 *
 * 這兩條都在驗同一件事——**改完分類之後，記帳表單的下拉要跟著變**。
 * 那是跨頁面的快取失效：`useCreateCategory` 少做一次 `invalidateQueries`
 * 不會拋錯、不會讓任何單元測試變紅，下拉只會安靜地停在舊清單。
 * 元件測試看不到這件事，因為它只渲染一頁。
 *
 * 定位一律用可及性選取器，不用 CSS class（見 `ui.ts` 的說明）。
 */

test('新增的分類立刻出現在記帳表單的下拉裡', async ({ signedInPage: page }) => {
  await page.getByRole('link', { name: '分類' }).click();

  await expect(page.getByRole('heading', { name: '分類' })).toBeVisible();

  await page.getByRole('button', { name: '新增支出分類' }).click();

  // 操作限定在彈窗裡。整頁找「新增」會同時對到兩顆區塊按鈕（「新增支出分類」
  // 「新增收入分類」），因為 Playwright 的名稱比對預設是包含而非相等。
  const dialog = page.getByRole('dialog', { name: '新增支出分類' });
  await dialog.getByLabel('名稱').fill('寵物');
  await dialog.getByRole('button', { name: '新增', exact: true }).click();

  // 先確認它真的進了支出那一組。
  await expect(page.getByRole('listitem').filter({ hasText: '寵物' })).toBeVisible();

  await page.getByRole('link', { name: '首頁' }).click();
  // 右側欄預設關閉（spec 2i 修訂 5），先打開新增表單。
  await openNewTransaction(page);

  // 關鍵斷言：不重整頁面，下拉就該有這個選項。
  await expect(newTransactionForm(page).getByLabel('分類')).toContainText('寵物');
});

test('改名後的分類在記帳表單的下拉裡顯示新名字', async ({ signedInPage: page, userA, request }) => {
  const ledger = await personalLedger(request, userA.token);
  const categories = await listCategories(request, userA.token, ledger.id);
  const expense = categories.find((category) => category.type === 'EXPENSE')!;

  await page.getByRole('link', { name: '分類' }).click();

  await page.getByRole('button', { name: `改名${expense.name}` }).click();

  const dialog = page.getByRole('dialog', { name: '編輯分類' });
  await dialog.getByLabel('名稱').fill('外食');
  await dialog.getByRole('button', { name: '儲存' }).click();

  await expect(page.getByRole('listitem').filter({ hasText: '外食' })).toBeVisible();

  await page.getByRole('link', { name: '首頁' }).click();
  await openNewTransaction(page);

  const categorySelect = newTransactionForm(page).getByLabel('分類');
  await expect(categorySelect).toContainText('外食');
  // 舊名字必須真的消失，不是多出一個選項。
  await expect(categorySelect).not.toContainText(expense.name);
});
