import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { createTransaction, listAccounts, listCategories, personalLedger } from './api';
import { expect, test } from './fixtures';
import {
  newTransactionForm,
  openNewTransaction,
  openTransactions,
  openUserMenu,
  transactionFilters,
} from './ui';

/**
 * 版面量測：2h 的 SC-24、SC-26.7、SC-28、SC-29，與 2i 的 SC-31～SC-36
 * （`docs/specs/phase-2h-web-visual.md`、`docs/specs/phase-2i-web-layout-v2.md`）。
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

/**
 * 等某個元素的位置停下來。側欄與右側欄的開合有 220ms 動畫，量測前要等它跑完，
 * 否則量到的是半途的位置。連續兩次取樣相同才算停。
 */
async function settledBox(locator: Locator) {
  let previous = await locator.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await locator.page().waitForTimeout(50);
    const current = await locator.boundingBox();
    if (
      previous &&
      current &&
      previous.x === current.x &&
      previous.y === current.y &&
      previous.width === current.width
    ) {
      return current;
    }
    previous = current;
  }
  return previous!;
}

/** 頁首（標題所在的 `<header>`）的水平中心。頁首的寬度就是內容容器的寬度。 */
async function headerCenter(page: Page, title: string): Promise<number> {
  const header = page
    .getByRole('heading', { level: 2, name: title, exact: true })
    .locator('xpath=ancestor::header[1]');
  const box = await settledBox(header);
  return box.x + box.width / 2;
}

/** `<main>` 就是外殼的中間欄：左緣＝側欄右緣，右緣＝右側欄左緣（或視窗右緣）。 */
async function mainBox(page: Page) {
  return settledBox(page.getByRole('main'));
}

test('SC-24.3：1440×900 的交易頁首屏至少看得到 10 筆交易', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await seedTransactions(request, userA.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  // 2i：交易表格從首頁搬到交易頁（SC-34.4）。
  await openTransactions(page);
  await expect(page.getByRole('listitem')).toHaveCount(20);

  expect(await fullyVisibleRows(page)).toBeGreaterThanOrEqual(10);
});

test('SC-28.1：篩選列的四個欄位一樣高', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTransactions(page);
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

/**
 * 鍵盤走到日期欄位要看得到焦點框。Chromium 的日期欄位只符合 `:focus-within`，
 * 全域的 `:focus-visible` 對它無效——這個洞 jsdom 看不到，只能在真瀏覽器裡驗。
 */
test('SC-26.7：用 Tab 走到篩選的日期欄位，看得到焦點框', async ({ signedInPage: page }) => {
  await openTransactions(page);
  const filters = transactionFilters(page);
  await filters.getByLabel('分類').focus();
  await page.keyboard.press('Tab');

  const startDate = filters.getByLabel('起日');
  await expect(startDate).toBeFocused();
  const outline = await startDate.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('SC-24.5：每一頁的標題都從同一條左緣開始', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2i 第二輪修訂：所有頁面同一個內容寬度（72rem），標題又回到同一條左緣。
  // 只比 x 座標：高度本來就可以不同。
  const pages: [string, string][] = [
    ['/', '總覽'],
    ['/transactions', '交易'],
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

  for (const path of ['/', '/transactions', '/accounts', '/categories', '/ledgers', '/profile']) {
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

/**
 * SC-31.1：側欄收合前後，每個 icon 的位置都不變（spec 2i §4.3）。
 *
 * 量導覽、收合鈕與使用者按鈕裡的 `svg`／頭像中心。收合只改側欄寬度與文字透明度，
 * 任何一列的高度或內距跟著變，icon 就會上下移動，這裡就會紅。
 */
test('SC-31.1：側欄收合前後，icon 的位置不變', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = page.getByRole('complementary');
  const icons = sidebar.locator('nav svg, button svg');

  async function centers() {
    await settledBox(sidebar);
    return icons.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
      }),
    );
  }

  const before = await centers();
  await page.getByRole('button', { name: '收合側欄' }).click();
  await expect(page.getByRole('button', { name: '展開側欄' })).toBeVisible();
  const after = await centers();

  expect(before.length).toBeGreaterThanOrEqual(6);
  expect(after).toHaveLength(before.length);
  before.forEach(([x, y], index) => {
    expect(Math.abs(x! - after[index]![0]!)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y! - after[index]![1]!)).toBeLessThanOrEqual(0.5);
  });
});

/**
 * SC-31.2、SC-39：開合是 320ms 的抽屜動畫。動畫由網站裡的設定開關決定（第三輪），
 * **不看**作業系統的「減少動態效果」——模擬系統要求減少動畫時仍然有動畫，
 * 在設定裡關掉（localStorage 的 `ledger.motion`）才沒有。
 */
test('SC-31.2：側欄開合有動畫；只有在設定裡關掉才沒有', async ({ signedInPage: page }) => {
  const sidebar = page.getByRole('complementary');
  const duration = () =>
    sidebar.evaluate((element) => getComputedStyle(element).transitionDuration);

  expect(await duration()).toMatch(/0\.32s/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toMatch(/0\.32s/);

  await page.evaluate(() => window.localStorage.setItem('ledger.motion', 'off'));
  await page.reload();
  await expect(sidebar).toBeVisible();
  expect(await duration()).not.toMatch(/0\.32s/);
});

/**
 * SC-31.6：901–1199px 側欄預設收合，但仍然可以自己展開；展開時浮在內容上，
 * 中間內容不移動；點連結就收回。
 */
test('SC-31.6：1024px 的側欄可以展開，而且不推擠內容', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const before = await mainBox(page);

  await page.getByRole('button', { name: '展開側欄' }).click();
  await expect(page.getByRole('button', { name: '收合側欄' })).toBeVisible();
  const during = await mainBox(page);
  expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(0.5);

  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '帳戶' })
    .click();
  await expect(page.getByRole('button', { name: '展開側欄' })).toBeVisible();
});

test('SC-32.3：使用者選單與設定彈窗可以完全用鍵盤操作', async ({ signedInPage: page }) => {
  const trigger = page.getByRole('button', { name: /的選單$|^帳號選單$/ });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const settings = page.getByRole('button', { name: '設定' });
  await expect(settings).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  // 第二輪修訂 8：「設定」打開彈窗，外觀是三張預覽卡。
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '設定' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '淺色' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('SC-35.1：管理頁沒有右側欄，也沒有「新增交易」', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewTransaction(page);
  await expect(newTransactionForm(page)).toBeVisible();

  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '帳戶' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: '帳戶' })).toBeVisible();

  await expect(newTransactionForm(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增交易' })).toHaveCount(0);
  // 沒有右側欄時，中間欄一路延伸到視窗右緣。
  const main = await mainBox(page);
  expect(Math.abs(main.x + main.width - 1440)).toBeLessThanOrEqual(1);
});

/**
 * SC-35.1–35.3（第二輪修訂 5）：右側欄預設關閉，按「＋ 新增交易」打開並把焦點送到
 * 金額欄；收起後重新整理仍是關的（不記憶）。關著的時候表單設了 `inert`，鍵盤
 * 走不進去；中間欄一路延伸到視窗右緣。
 */
test('SC-35.2：右側欄預設關閉，「新增交易」會把它打開', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const inert = () =>
    newTransactionForm(page).evaluate((element) => element.closest('[inert]') !== null);

  await expect(newTransactionForm(page)).toHaveCount(1);
  expect(await inert()).toBe(true);
  const closed = await mainBox(page);
  expect(Math.abs(closed.x + closed.width - 1440)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '新增交易' }).click();
  expect(await inert()).toBe(false);
  await expect(newTransactionForm(page).getByLabel('金額')).toBeFocused();

  await page.getByRole('button', { name: '收起新增面板' }).click();
  expect(await inert()).toBe(true);

  await page.getByRole('button', { name: '新增交易' }).click();
  await page.reload();
  await expect(newTransactionForm(page)).toHaveCount(1);
  expect(await inert()).toBe(true);
});

test('SC-36.1：側欄開合前後，內容都在中間欄置中', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  async function expectCentered() {
    const main = await mainBox(page);
    const center = await headerCenter(page, '總覽');
    expect(Math.abs(center - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
    return main;
  }

  const initial = await expectCentered();

  await page.getByRole('button', { name: '收合側欄' }).click();
  const leftCollapsed = await expectCentered();
  expect(leftCollapsed.width).toBeGreaterThan(initial.width);

  // 打開右側欄：中間欄被推窄，內容仍然置中。
  await page.getByRole('button', { name: '新增交易' }).click();
  const panelOpen = await expectCentered();
  expect(panelOpen.width).toBeLessThan(leftCollapsed.width);
});

test('使用者選單收著「登出」與「個人資料」', async ({ signedInPage: page }) => {
  await openUserMenu(page);

  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await page.getByRole('link', { name: '個人資料' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '個人資料' })).toBeVisible();
});
