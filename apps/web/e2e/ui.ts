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
