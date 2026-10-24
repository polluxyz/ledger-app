import { mkdir, writeFile } from 'node:fs/promises';
import type { Locator, Page, Route, TestInfo } from '@playwright/test';
import {
  createAccount,
  createCategory,
  createDebtEntry,
  createTransaction,
  listAccounts,
  listCategories,
  markTransaction,
  personalLedger,
  type TestUser,
} from './api';
import { API_BASE_URL } from './env';
import { expect, test } from './fixtures';
import { newTransactionForm, openNewTransaction, openUserMenu, selectCategory } from './ui';

interface HomeSetup {
  ledger: Awaited<ReturnType<typeof personalLedger>>;
  account: Awaited<ReturnType<typeof listAccounts>>[number];
  expenseCategory: Awaited<ReturnType<typeof listCategories>>[number];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 首頁改版的瀏覽器驗收：以前置 API 建立真實帳務資料，再透過畫面操作寫入與切換設定。
 * 版面斷言直接量瀏覽器方框，量測值與截圖寫到 Playwright 的 gitignore 輸出目錄。
 */
test.describe('2k 首頁改版端對端', () => {
  test('SC-H1：1280px 與 390px 的首頁區塊依 W260 排列', async ({ signedInPage: page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectHomeSectionOrder(page, width);
    }
  });

  test('SC-H3：首頁新增支出後相關數字一起更新，重抓期間保留舊值', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    await createAccount(request, userA.token, {
      name: '記帳驗收現金',
      initialBalance: 100_000,
    });
    const cash = (await listAccounts(request, userA.token)).find(
      (account) => account.name === '記帳驗收現金',
    );
    if (!cash) throw new Error('找不到首頁即時更新測試帳戶。');

    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'INCOME',
      amount: 5_000,
      date: currentTaiwanDate(),
      categoryId: (await listCategories(request, userA.token, setup.ledger.id)).find(
        (category) => category.type === 'INCOME',
      )!.id,
      accountId: cash.id,
      title: '首頁即時更新基準收入',
    });
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'EXPENSE',
      amount: 2_500,
      date: currentTaiwanDate(),
      categoryId: setup.expenseCategory.id,
      accountId: cash.id,
      title: '首頁即時更新基準支出',
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const statistics = page.locator('[aria-label="本月收支"]');
    const expenseStat = statistics.getByRole('link', { name: /^本月支出/ });
    const incomeStat = statistics.getByRole('link', { name: /^本月收入/ });
    const netStat = statistics.getByRole('link', { name: /^結餘/ });
    const categories = page.getByRole('list', { name: '支出分類' });
    const foodRow = categories
      .getByRole('listitem')
      .filter({ hasText: setup.expenseCategory.name });
    const total = page.locator('[aria-label^="總額 "]');
    const trend = page.locator('svg[role="group"][aria-label^="每月資產"]');
    const finalTrendPoint = trend.locator('circle[role="button"]').last();
    const accountBalance = page.getByLabel('記帳驗收現金餘額');

    await expect(expenseStat).toContainText('$25');
    await expect(incomeStat).toContainText('$50');
    await expect(netStat).toContainText('$25');
    await expect(foodRow).toContainText('$25');
    await expect(total).toHaveText('$1,025');
    await expect(finalTrendPoint).toHaveAttribute('aria-label', /\$1,025/);
    await expect(accountBalance).toHaveText('$1,025');

    const expectedRefetches = ['accounts', 'balance-trend', 'statistics'];
    const startedRefetches = new Set<string>();
    let releaseRefetches = () => {};
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetches = resolve;
    });
    const apiOrigin = new URL(API_BASE_URL).origin;
    const holdRelevantRefetches = async (route: Route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      const isRelevantGet = route.request().method() === 'GET' && url.origin === apiOrigin;
      let refetch: string | null = null;
      if (isRelevantGet && pathname.endsWith('/accounts')) refetch = 'accounts';
      if (isRelevantGet && pathname.endsWith('/accounts/balance-trend')) {
        refetch = 'balance-trend';
      }
      if (isRelevantGet && pathname.endsWith(`/ledgers/${setup.ledger.id}/statistics`)) {
        refetch = 'statistics';
      }
      if (refetch) {
        startedRefetches.add(refetch);
        await refetchGate;
      }
      await route.continue();
    };

    await page.route('**/*', holdRelevantRefetches);
    const urlBeforeWrite = page.url();
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations += 1;
    });
    try {
      await openNewTransaction(page);
      const form = newTransactionForm(page);
      await form.getByLabel('金額').fill('12.34');
      await form.getByLabel('帳戶').selectOption(cash.id);
      await form.getByLabel('名稱').fill('首頁即時更新新支出');
      await selectCategory(form, setup.expenseCategory.name);
      await form.getByRole('button', { name: '新增', exact: true }).click();

      await expect.poll(() => [...startedRefetches].sort()).toEqual([...expectedRefetches].sort());

      await expect(expenseStat).toContainText('$25');
      await expect(incomeStat).toContainText('$50');
      await expect(netStat).toContainText('$25');
      await expect(foodRow).toContainText('$25');
      await expect(total).toHaveText('$1,025');
      await expect(finalTrendPoint).toHaveAttribute('aria-label', /\$1,025/);
      await expect(accountBalance).toHaveText('$1,025');
      await expect(statistics).not.toContainText('載入中');
      await expect(page.locator('section[aria-labelledby="home-asset-heading"]')).not.toContainText(
        '載入中',
      );

      releaseRefetches();
      await expect(expenseStat).toContainText('$37.34');
      await expect(incomeStat).toContainText('$50');
      await expect(netStat).toContainText('$12.66');
      await expect(foodRow).toContainText('$37.34');
      await expect(total).toHaveText('$1,012.66');
      await expect(finalTrendPoint).toHaveAttribute('aria-label', /\$1,012\.66/);
      await expect(accountBalance).toHaveText('$1,012.66');
      expect(page.url()).toBe(urlBeforeWrite);
      expect(mainFrameNavigations).toBe(0);
    } finally {
      releaseRefetches();
      await page.unroute('**/*', holdRelevantRefetches);
    }

    await writeMeasurement(testInfo, {
      scenario: 'SC-H3',
      refetched: [...startedRefetches].sort(),
      navigations: mainFrameNavigations,
      oldValuesDuringRefetch: {
        expense: '$25',
        income: '$50',
        net: '$25',
        category: '$25',
        assets: '$1,025',
        account: '$1,025',
      },
      finalValues: {
        expense: '$37.34',
        income: '$50',
        net: '$12.66',
        category: '$37.34',
        assets: '$1,012.66',
        account: '$1,012.66',
      },
    });
  });

  test('SC-H8：展開帳戶清單在 439px 為一欄、440px 為兩欄，右側欄打開時依實際寬度排版', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    for (let index = 2; index <= 12; index += 1) {
      await createAccount(request, userA.token, {
        name: `首頁帳戶 ${String(index).padStart(2, '0')}`,
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const assetCard = page.locator('section[aria-labelledby="home-asset-heading"]');
    const list = assetCard.getByRole('list', { name: '帳戶' });
    const toggle = assetCard.getByRole('button', { name: '全部 12 個' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
    await toggle.click();
    await expect(list.getByRole('listitem')).toHaveCount(12);

    const apiOrder = (await listAccounts(request, userA.token))
      .filter((account) => !account.isTemporary || account.hasTransactions)
      .map((account) => account.name);
    expect(apiOrder).toHaveLength(12);
    for (const [index, name] of apiOrder.entries()) {
      await expect(list.getByRole('listitem').nth(index)).toContainText(name);
    }

    const container = list.locator('xpath=..');
    const widths: Array<{ width: number; columns: number; first: Rect; second: Rect }> = [];
    for (const [width, columns] of [
      [439, 1],
      [440, 2],
    ] as const) {
      await container.evaluate((element, targetWidth) => {
        (element as HTMLElement).style.width = `${targetWidth}px`;
      }, width);
      await expect
        .poll(() => list.evaluate((element) => element.getBoundingClientRect().width))
        .toBe(width);
      const first = await getRect(list.getByRole('listitem').nth(0));
      const second = await getRect(list.getByRole('listitem').nth(1));
      if (columns === 1) {
        expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1);
        expect(second.y).toBeGreaterThan(first.y);
      } else {
        expect(second.x).toBeGreaterThan(first.x);
        expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
      }
      widths.push({ width, columns, first, second });
    }
    await container.evaluate((element) => {
      (element as HTMLElement).style.width = '';
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await openNewTransaction(page);
    const panelListWidth = await list.evaluate((element) => element.getBoundingClientRect().width);
    expect(panelListWidth).toBeLessThan(440);
    const panelFirst = await getRect(list.getByRole('listitem').nth(0));
    const panelSecond = await getRect(list.getByRole('listitem').nth(1));
    expect(Math.abs(panelFirst.x - panelSecond.x)).toBeLessThanOrEqual(1);
    expect(panelSecond.y).toBeGreaterThan(panelFirst.y);

    await writeMeasurement(testInfo, {
      scenario: 'SC-H8',
      widthMeasurements: widths,
      rightPanel: {
        viewportWidth: 1280,
        listWidth: panelListWidth,
        columns: 1,
      },
    });
  });

  for (const recentCount of [0, 1, 5]) {
    test(`SC-H13：最近 ${recentCount} 筆時趨勢卡與 SVG 尺寸符合規格`, async ({
      signedInPage: page,
      userA,
      request,
    }, testInfo) => {
      const setup = await getHomeSetup(request, userA);
      if (recentCount > 0) {
        for (let index = 0; index < recentCount; index += 1) {
          await createTransaction(request, userA.token, setup.ledger.id, {
            type: 'EXPENSE',
            amount: (index + 1) * 1_000,
            date: currentTaiwanDate(),
            categoryId: setup.expenseCategory.id,
            accountId: setup.account.id,
            title: `最近交易 ${index + 1}`,
          });
        }
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      const activityCard = page.locator('section[aria-label="最近與標註"]');
      if (recentCount === 0) {
        await expect(page.getByRole('tabpanel')).toContainText('還沒有任何交易');
      } else {
        await expect(page.getByRole('tabpanel').locator('li')).toHaveCount(recentCount);
      }
      const measurement = await expectDesktopTrendLayout(page, activityCard);
      await writeMeasurement(testInfo, {
        scenario: 'SC-H13',
        tab: 'recent',
        transactionCount: recentCount,
        ...measurement,
      });
    });
  }

  for (const markedCount of [2, 10, 12]) {
    test(`SC-H13：標註 ${markedCount} 筆${markedCount > 10 ? '展開後' : ''}趨勢卡符合規格`, async ({
      signedInPage: page,
      userA,
      request,
    }, testInfo) => {
      const setup = await getHomeSetup(request, userA);
      const transactions = [];
      for (let index = 0; index < markedCount; index += 1) {
        transactions.push(
          await createTransaction(request, userA.token, setup.ledger.id, {
            type: 'EXPENSE',
            amount: (index + 1) * 1_000,
            date: currentTaiwanDate(),
            categoryId: setup.expenseCategory.id,
            accountId: setup.account.id,
            title: `標註交易 ${index + 1}`,
          }),
        );
      }
      for (const transaction of transactions) {
        await markTransaction(request, userA.token, setup.ledger.id, transaction.id);
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      await expect(
        page.getByRole('tab', { name: `標註 ${markedCount}`, exact: true }),
      ).toBeVisible();
      const activityCard = page.locator('section[aria-label="最近與標註"]');
      await page.getByRole('tab', { name: `標註 ${markedCount}`, exact: true }).click();
      const panel = page.getByRole('tabpanel');
      await expect(panel.locator('li')).toHaveCount(Math.min(markedCount, 10));
      if (markedCount > 10) {
        await page.getByRole('button', { name: '再 2 筆', exact: true }).click();
        await expect(panel.locator('li')).toHaveCount(markedCount);
      }
      const measurement = await expectDesktopTrendLayout(page, activityCard);
      await writeMeasurement(testInfo, {
        scenario: 'SC-H13',
        tab: 'marked',
        transactionCount: markedCount,
        expanded: markedCount > 10,
        ...measurement,
      });
    });
  }

  test('SC-H13：390px 時趨勢 SVG 不超過 260px，點位和標籤都在 SVG 內', async ({
    signedInPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('svg[role="group"][aria-label^="每月資產"]')).toBeVisible();
    const svg = page.locator('svg[role="group"][aria-label^="每月資產"]');
    const box = await getRect(svg);
    expect(box.height).toBeLessThanOrEqual(260);
    const children = await expectSvgChildrenInside(svg);
    await writeMeasurement(testInfo, {
      scenario: 'SC-H13',
      viewportWidth: 390,
      svg: box,
      children,
    });
  });

  test('SC-H14：390px 淺色與深色容納長名稱、大金額、分類與帳戶清單', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    const longAccountName = '這是一個很長的首頁帳戶名稱用來檢查換行能力';
    await createAccount(request, userA.token, {
      name: longAccountName,
      initialBalance: 1_234_567_800,
    });
    for (let index = 2; index <= 11; index += 1) {
      await createAccount(request, userA.token, { name: `手機首頁帳戶 ${index}` });
    }

    const longCategoryName = '這是一個很長的首頁支出分類名稱用來檢查換行';
    const categories = [];
    for (let index = 0; index < 15; index += 1) {
      categories.push(
        await createCategory(request, userA.token, setup.ledger.id, {
          name: index === 0 ? longCategoryName : `手機首頁分類 ${index + 1}`,
          type: 'EXPENSE',
        }),
      );
    }
    let firstTransactionId = '';
    for (const [index, category] of categories.entries()) {
      const transaction = await createTransaction(request, userA.token, setup.ledger.id, {
        type: 'EXPENSE',
        amount: index === 0 ? 1_234_567_800 : 1_000,
        date: currentTaiwanDate(),
        categoryId: category.id,
        accountId: setup.account.id,
        title: `手機首頁支出 ${index + 1}`,
      });
      if (index === 0) firstTransactionId = transaction.id;
    }
    await markTransaction(request, userA.token, setup.ledger.id, firstTransactionId);

    const longPersonName = '這是一個非常長的首頁往來對象名稱用來檢查版面是否會超出畫面';
    await createDebtEntry(request, userA.token, {
      counterparty: { name: longPersonName },
      kind: 'LEND',
      amount: 1_234_567_800,
      date: currentTaiwanDate(),
      record: { ledgerId: setup.ledger.id, accountId: setup.account.id },
    });

    const measurements = [];
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('ledger.theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const assetCard = page.locator('section[aria-labelledby="home-asset-heading"]');
      const categorySection = page.locator('section[aria-labelledby="home-category-heading"]');
      const categoryToggle = categorySection.getByRole('button', {
        name: '全部 15 類',
        exact: true,
      });
      const accountToggle = page.getByRole('button', { name: '全部 12 個', exact: true });
      const accountList = assetCard.getByRole('list', { name: '帳戶' });
      await expect(
        page
          .locator('section[aria-labelledby="home-debts-heading"]')
          .getByText(longPersonName, {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await expect(categoryToggle).toBeVisible();
      await expect(accountToggle).toBeVisible();

      await categoryToggle.click();
      await accountToggle.click();
      await expect(page.getByRole('list', { name: '支出分類' }).getByRole('listitem')).toHaveCount(
        15,
      );
      await expect(accountList.getByRole('listitem')).toHaveCount(12);
      await expect(page.getByText(longCategoryName, { exact: true })).toBeVisible();
      await expect(accountList.getByText(longAccountName, { exact: true })).toBeVisible();
      await expect(accountList).toContainText('$12,345,678');

      const markedTab = page.getByRole('tab', { name: '標註 1', exact: true });
      await expect(markedTab).toBeVisible();
      const tabHeights = [];
      for (const tab of await page
        .getByRole('tablist', { name: '最近與標註' })
        .getByRole('tab')
        .all()) {
        const rect = await tab.boundingBox();
        if (!rect) throw new Error('無法量到首頁分頁的觸控區。');
        expect(rect.height).toBeGreaterThanOrEqual(44);
        tabHeights.push(rect.height);
      }
      const categoryToggleHeight = (
        await getRect(categorySection.getByRole('button', { name: '收起', exact: true }))
      ).height;
      const accountToggleHeight = (
        await getRect(assetCard.getByRole('button', { name: '收起', exact: true }).last())
      ).height;
      expect(categoryToggleHeight).toBeGreaterThanOrEqual(44);
      expect(accountToggleHeight).toBeGreaterThanOrEqual(44);

      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
      measurements.push({
        theme,
        dimensions,
        tabHeights,
        categoryToggleHeight,
        accountToggleHeight,
      });
    }

    await writeMeasurement(testInfo, {
      scenario: 'SC-H14',
      longAccountName,
      longCategoryName,
      longPersonName,
      measurements,
    });
  });

  test('SC-H18：首頁配色即時切換並保留，統計頁配色不受影響', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    const secondCategory = await createCategory(request, userA.token, setup.ledger.id, {
      name: '日常用品',
      type: 'EXPENSE',
    });
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'EXPENSE',
      amount: 3_000,
      date: currentTaiwanDate(),
      categoryId: setup.expenseCategory.id,
      accountId: setup.account.id,
      title: '首頁彩色分類一',
    });
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'EXPENSE',
      amount: 2_000,
      date: currentTaiwanDate(),
      categoryId: secondCategory.id,
      accountId: setup.account.id,
      title: '首頁彩色分類二',
    });

    const options = [
      {
        theme: 'light',
        label: '淺色',
        modes: [
          { value: 'color', label: '彩色' },
          { value: 'gold', label: '金色' },
          { value: 'gray', label: '灰色' },
        ],
      },
      {
        theme: 'dark',
        label: '深色',
        modes: [
          { value: 'color', label: '彩色' },
          { value: 'gold', label: '金色' },
          { value: 'gray', label: '灰色' },
        ],
      },
    ] as const;
    const statisticsColorByTheme = new Map<string, string>();
    const screenshots: string[] = [];
    const measurements = [];

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    for (const themeOption of options) {
      for (const mode of themeOption.modes) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openUserMenu(page);
        await page.getByRole('button', { name: '設定' }).click();
        const dialog = page.getByRole('dialog', { name: '設定' });
        await expect(dialog).toBeVisible();
        const appearance = dialog.getByRole('radiogroup', { name: '外觀' });
        await appearance.getByRole('radio', { name: themeOption.label, exact: true }).click();
        const colorGroup = dialog.getByRole('radiogroup', { name: '首頁分類條配色' });
        await colorGroup.getByRole('radio', { name: mode.label, exact: true }).click();
        await expect(
          colorGroup.getByRole('radio', { name: mode.label, exact: true }),
        ).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-theme', themeOption.theme);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        const homeColorBeforeReload = await readHomeCategoryColor(page);
        if (mode.value === 'gold') expect(homeColorBeforeReload).toBe('var(--color-accent)');
        if (mode.value === 'gray') {
          expect(homeColorBeforeReload).toBe(themeOption.theme === 'light' ? '#6a6252' : '#9d9482');
        }
        if (mode.value === 'color') expect(homeColorBeforeReload).toMatch(/^#[0-9a-f]{6}$/i);

        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', themeOption.theme);
        await expect.poll(() => readHomeCategoryColor(page)).toBe(homeColorBeforeReload);

        const screenshotsForMode: string[] = [];
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const path = testInfo.outputPath(`home-${themeOption.theme}-${mode.value}-${width}.png`);
          await page.screenshot({ path, fullPage: true, animations: 'disabled' });
          screenshots.push(path);
          screenshotsForMode.push(path);
        }

        await page.goto(
          `/stats?tab=cat&ledger=${encodeURIComponent(setup.ledger.id)}&month=${currentTaiwanMonth()}`,
        );
        await expect(
          page.getByRole('heading', { level: 2, name: '統計', exact: true }),
        ).toBeVisible();
        const statisticsColor = await readStatisticsCategoryColor(page);
        const existingColor = statisticsColorByTheme.get(themeOption.theme);
        if (existingColor === undefined)
          statisticsColorByTheme.set(themeOption.theme, statisticsColor);
        else expect(statisticsColor).toBe(existingColor);

        await page.goto('/');
        await expect(page.locator('[aria-label="支出分類"]')).toBeVisible();
        measurements.push({
          theme: themeOption.theme,
          mode: mode.value,
          homeColor: homeColorBeforeReload,
          statisticsColor,
          screenshots: screenshotsForMode,
        });
      }
    }

    await writeMeasurement(testInfo, {
      scenario: 'SC-H18',
      statisticsColorByTheme: Object.fromEntries(statisticsColorByTheme),
      screenshots,
      measurements,
    });
  });
});

async function getHomeSetup(
  request: Parameters<typeof personalLedger>[0],
  user: TestUser,
): Promise<HomeSetup> {
  const ledger = await personalLedger(request, user.token);
  const accounts = await listAccounts(request, user.token);
  const account = accounts.find((item) => item.name === '現金' && !item.isTemporary);
  if (!account) throw new Error('測試帳號缺少預設的「現金」帳戶。');
  const categories = await listCategories(request, user.token, ledger.id);
  const expenseCategory = categories.find((item) => item.type === 'EXPENSE');
  if (!expenseCategory) throw new Error('測試帳本缺少預設的支出分類。');
  return { ledger, account, expenseCategory };
}

async function expectHomeSectionOrder(page: Page, width: number): Promise<void> {
  const heading = page.getByRole('heading', { level: 2, name: '總覽' });
  const summary = page.locator('[aria-label="本月收支"]');
  const pending = page.locator('section[aria-labelledby="pending-card-heading"]');
  const activity = page.locator('section[aria-label="最近與標註"]');
  const trend = page.locator('section[aria-labelledby="balance-trend-heading"]');
  const myHeading = page.getByRole('heading', { level: 2, name: '我的' });
  const asset = page.locator('section[aria-labelledby="home-asset-heading"]');
  const debts = page.locator('section[aria-labelledby="home-debts-heading"]');
  for (const section of [heading, summary, activity, trend, myHeading, asset, debts]) {
    await expect(section).toBeVisible();
  }
  const pendingExists = (await pending.count()) > 0;

  const [headingBox, summaryBox, pendingBox, activityBox, trendBox, myBox, assetBox, debtsBox] =
    await Promise.all([
      getRect(heading),
      getRect(summary),
      pendingExists ? getRect(pending) : Promise.resolve(null),
      getRect(activity),
      getRect(trend),
      getRect(myHeading),
      getRect(asset),
      getRect(debts),
    ]);
  expect(summaryBox.y).toBeGreaterThanOrEqual(headingBox.y);
  if (pendingBox) {
    expect(pendingBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height - 1);
    expect(activityBox.y).toBeGreaterThanOrEqual(pendingBox.y + pendingBox.height - 1);
  } else {
    expect(activityBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height - 1);
  }
  expect(myBox.y).toBeGreaterThanOrEqual(
    Math.max(activityBox.y + activityBox.height, trendBox.y + trendBox.height) - 1,
  );
  expect(assetBox.y).toBeGreaterThanOrEqual(myBox.y + myBox.height - 1);
  expect(debtsBox.y).toBeGreaterThanOrEqual(myBox.y + myBox.height - 1);

  if (width >= 1024) {
    expect(Math.abs(activityBox.y - trendBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(assetBox.y - debtsBox.y)).toBeLessThanOrEqual(1);
  } else {
    expect(trendBox.y).toBeGreaterThanOrEqual(activityBox.y + activityBox.height - 1);
    expect(debtsBox.y).toBeGreaterThanOrEqual(assetBox.y + assetBox.height - 1);
  }
}

async function expectDesktopTrendLayout(page: Page, activityCard: Locator) {
  const trendCard = page.locator('section[aria-labelledby="balance-trend-heading"]');
  await expect(activityCard).toBeVisible();
  await expect(trendCard).toBeVisible();
  const activityBox = await getRect(activityCard);
  const trendBox = await getRect(trendCard);
  expect(Math.abs(activityBox.y - trendBox.y)).toBeLessThanOrEqual(1);
  expect(trendBox.y + trendBox.height - (activityBox.y + activityBox.height)).toBeLessThanOrEqual(
    1,
  );

  const svg = page.locator('svg[role="group"][aria-label^="每月資產"]');
  const svgBox = await getRect(svg);
  expect(svgBox.height).toBeGreaterThanOrEqual(180);
  expect(svgBox.height).toBeLessThanOrEqual(320);
  await expect(svg.locator('circle[role="button"]')).toHaveCount(12);
  const children = await expectSvgChildrenInside(svg);
  return { activityBox, trendBox, svg: svgBox, children };
}

async function expectSvgChildrenInside(svg: Locator) {
  const svgBox = await getRect(svg);
  const points = svg.locator('circle[role="button"]');
  const labels = svg.locator('text');
  const pointCount = await points.count();
  const labelCount = await labels.count();
  expect(pointCount).toBeGreaterThan(0);
  expect(labelCount).toBeGreaterThanOrEqual(2);

  const children: Array<{ kind: 'point' | 'label'; index: number; rect: Rect }> = [];
  for (let index = 0; index < pointCount; index += 1) {
    const rect = await getRect(points.nth(index));
    expect(rect.x).toBeGreaterThanOrEqual(svgBox.x - 1);
    expect(rect.y).toBeGreaterThanOrEqual(svgBox.y - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(svgBox.y + svgBox.height + 1);
    children.push({ kind: 'point', index, rect });
  }
  for (let index = 0; index < labelCount; index += 1) {
    const rect = await getRect(labels.nth(index));
    expect(rect.x).toBeGreaterThanOrEqual(svgBox.x - 1);
    expect(rect.y).toBeGreaterThanOrEqual(svgBox.y - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(svgBox.y + svgBox.height + 1);
    children.push({ kind: 'label', index, rect });
  }
  return children;
}

async function readHomeCategoryColor(page: Page): Promise<string> {
  const swatch = page
    .getByRole('list', { name: '支出分類' })
    .getByRole('listitem')
    .first()
    .locator('span')
    .first();
  await expect(swatch).toBeVisible();
  return swatch.evaluate((element) =>
    (element as HTMLElement).style.getPropertyValue('--group-color'),
  );
}

async function readStatisticsCategoryColor(page: Page): Promise<string> {
  const swatch = page
    .getByRole('list', { name: '支出分類清單' })
    .getByRole('listitem')
    .first()
    .locator('span')
    .first();
  await expect(swatch).toBeVisible();
  return swatch.evaluate((element) =>
    (element as HTMLElement).style.getPropertyValue('--swatch-color'),
  );
}

async function getRect(locator: Locator): Promise<Rect> {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('無法取得首頁元件的實際方框。');
  return rect;
}

async function writeMeasurement(testInfo: TestInfo, measurement: unknown): Promise<void> {
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(
    testInfo.outputPath('home-measurements.json'),
    `${JSON.stringify(measurement, null, 2)}\n`,
    'utf8',
  );
}

function currentTaiwanDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('無法取得台灣日期。');
  return `${year}-${month}-${day}T12:00:00+08:00`;
}

function currentTaiwanMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('無法取得台灣月份。');
  return `${year}-${month}`;
}
