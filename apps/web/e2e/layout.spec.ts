import type { APIRequestContext, Page } from '@playwright/test';
import { createTransaction, listAccounts, listCategories, personalLedger } from './api';
import { expect, test } from './fixtures';
import { transactionFilters } from './ui';

/**
 * 2h 視覺改版的版面量測（spec `docs/specs/phase-2h-web-visual.md` SC-24、SC-28、SC-29）。
 *
 * 其他 e2e 驗「功能做不做得到」，這一份驗「版面有沒有退化」：這些數字是改版的
 * 驗收條件，而 CSS 小改一行就可能讓它們默默變差，單元測試（jsdom 不排版）看不到。
 *
 * 策略：用 API 建好資料，在真的瀏覽器裡量 `getBoundingClientRect()`。
 */

/** 從今天往回，每天 3 筆、共 21 筆——跨 7 天，才量得到日期標題佔掉的高度。 */
async function seedTransactions(request: APIRequestContext, token: string): Promise<void> {
  const ledger = await personalLedger(request, token);
  const [cash] = await listAccounts(request, token);
  const categories = await listCategories(request, token, ledger.id);
  const expense = categories.find((category) => category.type === 'EXPENSE')!;

  for (let index = 0; index < 21; index += 1) {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(index / 3));
    await createTransaction(request, token, ledger.id, {
      type: 'EXPENSE',
      amount: 100 + index,
      date: date.toISOString(),
      categoryId: expense.id,
      accountId: cash!.id,
    });
  }
}

/** 完整落在視窗內的交易列數。只露出一半的不算——使用者看不到金額。 */
async function fullyVisibleRows(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('main li')].filter(
        (item) => item.getBoundingClientRect().bottom <= window.innerHeight,
      ).length,
  );
}

test('SC-24.3：1440×900 的首屏至少看得到 10 筆交易', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await seedTransactions(request, userA.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(20);

  expect(await fullyVisibleRows(page)).toBeGreaterThanOrEqual(10);
});

test('SC-28.1：篩選列的四個欄位一樣高', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const filters = transactionFilters(page);
  await expect(filters).toBeVisible();

  const heights = await Promise.all(
    ['型別', '分類', '起日', '迄日'].map(async (label) => {
      const box = await filters.getByLabel(label).boundingBox();
      return Math.round(box!.height);
    }),
  );

  expect(new Set(heights).size).toBe(1);
});

test('SC-24.5：每一頁的標題都從同一條左緣開始', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 首頁的標題是「總覽」，其餘是各頁的名稱。只比 x 座標：高度本來就可以不同。
  const pages: [string, string][] = [
    ['/', '總覽'],
    ['/accounts', '帳戶'],
    ['/categories', '分類'],
    ['/ledgers', '帳本'],
    ['/profile', '個人資料'],
  ];
  const lefts: number[] = [];
  for (const [path, title] of pages) {
    await page.goto(path);
    const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
    await expect(heading).toBeVisible();
    lefts.push((await heading.boundingBox())!.x);
  }

  for (const left of lefts) {
    expect(Math.abs(left - lefts[0]!)).toBeLessThanOrEqual(1);
  }
});

test('SC-24.6：375px 寬也不會橫向捲動', async ({ signedInPage: page, userA, request }) => {
  await seedTransactions(request, userA.token);
  await page.setViewportSize({ width: 375, height: 812 });

  for (const path of ['/', '/accounts', '/categories', '/ledgers', '/profile']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} 出現橫向捲動`).toBe(0);
  }
});

/**
 * SC-29.3：選了淺色的人重新整理，第一個畫面就是淺色——不能先閃一下深色。
 *
 * 證明方式：**把應用程式本身擋掉**（dev server 的進入點是 `/src/main.tsx`），只讓
 * HTML 與 `theme-init.js` 載入。React 根本沒跑，`<html>` 卻已經帶著 `data-theme`，
 * 就代表顏色是在第一次繪製前決定的。
 */
test('SC-29.3：選了淺色，應用程式執行前就已經是淺色', async ({ page }) => {
  await page.route(/\/src\/main\.tsx/, (route) => route.abort());
  await page.addInitScript(() => window.localStorage.setItem('ledger.theme', 'light'));

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('SC-29.3：沒選過就跟隨系統，不帶 data-theme', async ({ page }) => {
  await page.route(/\/src\/main\.tsx/, (route) => route.abort());

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});
