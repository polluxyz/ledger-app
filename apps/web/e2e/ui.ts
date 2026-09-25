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

/**
 * 切換上方橫條的作用中帳本。只有一本帳本時切換器是一段文字，不是下拉。
 *
 * 2i 第三輪（SC-40）：切換器是自己做的清單，不是原生 `<select>`，所以改成
 * 「點開按鈕 → 點選項」。選項名稱後面還帶著「私人／共享」小標籤，用包含比對。
 */
export async function switchLedger(page: Page, name: string): Promise<void> {
  const switcher = page.getByRole('group', { name: '作用中帳本' });
  await switcher.getByRole('button').click();
  await switcher.getByRole('option', { name }).click();
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
 * 在選人的下拉選單（3b-2 W24）輸入名字，再按 Esc 收起清單。
 *
 * 用 combobox 角色找輸入框：`getByLabel` 是部分比對，會同時對到清單本身
 * （它的名稱是「{label}選項」）。收起清單是因為它會蓋住下方的種類按鈕。
 */
export async function typeCounterparty(
  scope: Locator,
  name: string,
  label = '對象',
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label, exact: true });
  await input.fill(name);
  await input.press('Escape');
}

/**
 * 打開側欄底部的使用者選單（spec 2i SC-32）。「登出」「個人資料」都收在裡面。
 * 取不到使用者名稱時按鈕叫「帳號選單」，所以兩種名稱都接受。
 */
export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /的選單$|^帳號選單$/ }).click();
}
