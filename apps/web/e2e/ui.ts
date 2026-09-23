import type { Locator, Page } from '@playwright/test';

/**
 * 畫面操作的共用輔助函式。
 *
 * 定位一律用可及性選取器（`getByRole` / `getByLabel`）。**不可以用 CSS class**
 * ——CSS Modules 的 class 名稱是編譯產生的，改個樣式就爛。
 */

/** 把畫面上的「$1,234」變回數字，好做加減比較。 */
export function parseAmount(text: string | null): number {
  return Number((text ?? '').replace(/[$,\s]/g, ''));
}

/** 切換頁首的作用中帳本。只有一本帳本時切換器是一段文字，不是下拉。 */
export async function switchLedger(page: Page, name: string): Promise<void> {
  await page.getByLabel('作用中帳本').selectOption({ label: name });
}

/**
 * 首頁「新增一筆交易」的表單。
 *
 * 首頁上有兩個「分類」下拉——新增表單一個、篩選列一個——所以整頁找會同時對到兩個。
 * fieldset 的 `<legend>` 就是這個群組的無障礙名稱。
 */
export function newTransactionForm(page: Page): Locator {
  return page.getByRole('group', { name: '新增一筆交易' });
}

/** 交易列表的篩選列。 */
export function transactionFilters(page: Page): Locator {
  return page.getByRole('region', { name: '篩選交易' });
}

/** 交易列表裡符合某段文字的那一列（例如金額）。 */
export function transactionRow(page: Page, hasText: string): Locator {
  return page.getByRole('listitem').filter({ hasText });
}

/**
 * 從側欄走到交易頁（spec 2i：交易表格從首頁搬到 `/transactions`）。
 *
 * 點連結而不是 `goto`：`goto` 會整頁重新載入，把 React Query 的快取一起清掉，
 * 測試就驗不到「改動之後畫面有沒有跟著更新」。
 */
export async function openTransactions(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '交易' })
    .click();
  await page.getByRole('heading', { level: 2, name: '交易' }).waitFor();
}

/** 從側欄回到首頁（dashboard）。理由同 `openTransactions`。 */
export async function openDashboard(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '首頁' })
    .click();
  await page.getByRole('heading', { level: 2, name: '總覽' }).waitFor();
}

/**
 * 打開右側欄的新增表單（spec 2i 第二輪修訂 5：右側欄預設關閉）。
 * 「＋ 新增交易」在總覽與交易頁的上方橫條右邊。
 */
export async function openNewTransaction(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新增交易' }).click();
  await newTransactionForm(page).getByLabel('金額').waitFor();
}

/**
 * 打開側欄底部的使用者選單（spec 2i SC-32）。「登出」「個人資料」都收在裡面。
 * 取不到使用者名稱時按鈕叫「帳號選單」，所以兩種名稱都接受。
 */
export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /的選單$|^帳號選單$/ }).click();
}
