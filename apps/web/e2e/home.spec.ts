import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page, Route, TestInfo } from '@playwright/test';
import {
  addMember,
  createAccount,
  createCategory,
  createLedger,
  createDebtEntry,
  createTransaction,
  listAccounts,
  listCategories,
  linkByEmail,
  markTransaction,
  personalLedger,
  type TestUser,
} from './api';
import { API_BASE_URL } from './env';
import { expect, test } from './fixtures';
import {
  newTransactionForm,
  openDashboard,
  openNewTransaction,
  openUserMenu,
  selectCategory,
} from './ui';

interface HomeSetup {
  ledger: Awaited<ReturnType<typeof personalLedger>>;
  account: Awaited<ReturnType<typeof listAccounts>>[number];
  expenseCategory: Awaited<ReturnType<typeof listCategories>>[number];
  incomeCategory: Awaited<ReturnType<typeof listCategories>>[number];
}

const HOME_PALETTE_THEME_OPTIONS = [
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

type HomePaletteThemeOption = (typeof HOME_PALETTE_THEME_OPTIONS)[number];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HOME_CARD_IDS = [
  'expense',
  'income',
  'net',
  'trend',
  'categories',
  'activity',
  'accounts',
  'debts',
] as const;

type HomeCardId = (typeof HOME_CARD_IDS)[number];

const APLUS_SHOTS_DIR = fileURLToPath(
  new URL('../../../docs/artifacts/2l-aplus-shots/', import.meta.url),
);

/**
 * 首頁改版的瀏覽器驗收：以前置 API 建立真實帳務資料，再透過畫面操作寫入與切換設定。
 * 版面斷言直接量瀏覽器方框；量測值放 Playwright 輸出目錄，A+ 展示截圖放 gitignore 的 artifacts。
 */
test.describe('2l 首頁 A+ 版面端對端', () => {
  test('SC-Y1：預設卡片在 1280px 展開與收合側欄時維持三列比例', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }, testInfo) => {
    const linked = await linkByEmail(request, userB, userA);
    await createDebtEntry(request, userB.token, {
      counterparty: { id: linked.inviterSideId },
      kind: 'LEND',
      amount: 10_000,
      date: currentTaiwanDate(),
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await ensureSidebarExpanded(page);
    const viewportInset = await measureViewportInset(page);
    // 1280px 扣掉實測捲軸與 stable 保留區、展開側欄 240px、兩側各 32px；收合側欄改扣 72px。
    const expandedContentWidth = 1280 - viewportInset.layoutGutterWidth - 240 - 64;
    const collapsedContentWidth = 1280 - viewportInset.layoutGutterWidth - 72 - 64;
    const pendingCard = page.locator('section[aria-labelledby="pending-card-heading"]');
    await expect(pendingCard).toBeVisible();

    const expanded = await waitForHomeCards(page, (snapshot) => {
      expect(Math.abs(snapshot.layout.width - expandedContentWidth)).toBeLessThanOrEqual(2);
      expectDefaultHomeRows(snapshot.cards);
    });
    const firstRowBottom = Math.max(
      ...(['expense', 'income', 'net'] as const).map(
        (cardId) => expanded.cards[cardId].y + expanded.cards[cardId].height,
      ),
    );
    const pendingBox = await getRect(pendingCard);
    expect(pendingBox.y).toBeGreaterThanOrEqual(firstRowBottom - 2);
    expect(expanded.cards.trend.y).toBeGreaterThanOrEqual(pendingBox.y + pendingBox.height - 2);

    await page.getByRole('button', { name: '收合側欄', exact: true }).click();
    await expect(page.getByRole('button', { name: '展開側欄', exact: true })).toBeVisible();
    const collapsed = await waitForHomeCards(page, (snapshot) => {
      expect(Math.abs(snapshot.layout.width - collapsedContentWidth)).toBeLessThanOrEqual(2);
      expectDefaultHomeRows(snapshot.cards);
    });

    await writeMeasurement(testInfo, {
      scenario: 'SC-Y1',
      viewportInset,
      expanded: { layoutWidth: expanded.layout.width, cards: expanded.cards, pendingBox },
      collapsed: { layoutWidth: collapsed.layout.width, cards: collapsed.cards },
    });
  });

  test('SC-Y2：390px 與 900px 固定一欄，901px 回到桌機版面', async ({ signedInPage: page }) => {
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = page.locator('[data-home-layout="narrow"]');
      await expect(layout).toBeVisible();
      const cardIds = await readCardIds(layout);
      expect(cardIds).toEqual(HOME_CARD_IDS);
      await expectNoHorizontalPageOverflow(page);
    }

    await page.setViewportSize({ width: 901, height: 900 });
    await expect(page.locator('[data-home-layout="tree"]')).toBeVisible();
    const desktop = await readHomeCards(page);
    expect(desktop.cardIds).toEqual(HOME_CARD_IDS);
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
    const expenseStat = page.locator('[data-home-card-id="expense"]');
    const incomeStat = page.locator('[data-home-card-id="income"]');
    const netStat = page.locator('[data-home-card-id="net"]');
    const categories = page.getByRole('list', { name: '支出分類' });
    const foodRow = categories
      .getByRole('listitem')
      .filter({ hasText: setup.expenseCategory.name });
    const total = page.locator('[aria-label^="總資產 "] strong');
    const trend = page.locator('svg[role="group"][aria-label^="每月資產"]');
    const trendCard = page.locator('[data-home-card-id="trend"]');
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
      await expect(trendCard).not.toContainText('載入中');

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

  test('SC-Y3：卡片分割剛好放得下、少 1px 與全部換行，恢復寬度後回到原版面', async ({
    signedInPage: page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await ensureSidebarExpanded(page);
    const viewportInset = await measureViewportInset(page);
    // 三卡剛好寬度為 3×309px + 2×16px＝959px；少 1px 時目標為 958px。
    // 視窗寬度＝目標內容寬＋實測捲軸與 stable 保留區＋側欄（240／72px）＋新增面板（0／360px）＋兩側外距 64px。
    const viewportForContent = (contentWidth: number, sidebarWidth: number, drawerWidth: number) =>
      contentWidth + viewportInset.layoutGutterWidth + sidebarWidth + drawerWidth + 64;
    const justFitsViewport = viewportForContent(959, 240, 0);
    const onePixelShortViewport = viewportForContent(958, 240, 0);
    await page.setViewportSize({ width: justFitsViewport, height: 900 });
    const justFits = await waitForHomeCards(page, (snapshot) => {
      expect(Math.round(snapshot.layout.width)).toBe(959);
      expectDefaultHomeRows(snapshot.cards);
    });
    await expectNoHorizontalPageOverflow(page);

    await page.setViewportSize({ width: onePixelShortViewport, height: 900 });
    const onePixelShort = await waitForHomeCards(page, (snapshot) => {
      expect(Math.round(snapshot.layout.width)).toBe(958);
      expectCardRows(snapshot.cards, [
        ['expense', 'income'],
        ['net'],
        ['trend', 'categories'],
        ['activity', 'accounts'],
        ['debts'],
      ]);
    });
    await expectNoHorizontalPageOverflow(page);

    const allWrappedViewport = viewportForContent(390, 72, 360);
    const allWrappedLayout: HomeLayoutKind = allWrappedViewport <= 900 ? 'narrow' : 'tree';
    await ensureSidebarCollapsed(page);
    await page.setViewportSize({ width: allWrappedViewport, height: 900 });
    await openNewTransaction(page);
    const allWrapped = await waitForHomeCards(
      page,
      (snapshot) => {
        expect(Math.round(snapshot.layout.width)).toBe(390);
        expectCardRows(snapshot.cards, [
          ['expense'],
          ['income'],
          ['net'],
          ['trend'],
          ['categories'],
          ['activity'],
          ['accounts'],
          ['debts'],
        ]);
      },
      allWrappedLayout,
    );
    await expectNoHorizontalPageOverflow(page);

    await page.getByRole('button', { name: '收起新增面板', exact: true }).click();
    await page.setViewportSize({ width: justFitsViewport, height: 900 });
    await ensureSidebarExpanded(page);
    const restored = await waitForHomeCards(page, (snapshot) => {
      expect(Math.round(snapshot.layout.width)).toBe(959);
      expectDefaultHomeRows(snapshot.cards);
    });
    expectCardRectsClose(restored.cards, justFits.cards);

    await writeMeasurement(testInfo, {
      scenario: 'SC-Y3',
      viewportInset,
      viewportWidths: {
        justFits: justFitsViewport,
        onePixelShort: onePixelShortViewport,
        allWrapped: allWrappedViewport,
      },
      allWrappedLayout,
      contentWidths: {
        justFits: justFits.layout.width,
        onePixelShort: onePixelShort.layout.width,
        allWrapped: allWrapped.layout.width,
        restored: restored.layout.width,
      },
      cardRows: {
        justFits: justFits.cards,
        onePixelShort: onePixelShort.cards,
        allWrapped: allWrapped.cards,
      },
    });
  });

  test('SC-Y8：六個帳戶的展開清單依 439px／440px 容器寬換欄，收起時保持一欄', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    for (let index = 2; index <= 6; index += 1) {
      await createAccount(request, userA.token, {
        name: `首頁帳戶 ${String(index).padStart(2, '0')}`,
      });
    }
    await page.reload();

    const accountsCard = page.locator('[data-home-card-id="accounts"]');
    const list = accountsCard.getByRole('list', { name: '帳戶' });
    const apiOrder = (await listAccounts(request, userA.token))
      .filter((account) => !account.isTemporary || account.hasTransactions)
      .map((account) => account.name);
    expect(apiOrder).toHaveLength(6);

    const widths: Array<{
      viewportWidth: number;
      contentWidth: number;
      columns: number;
      first: Rect;
      second: Rect;
    }> = [];
    for (const viewportWidth of [1280, 390]) {
      await page.setViewportSize({ width: viewportWidth, height: 900 });
      await accountsCard.getByRole('button', { name: '全部 6 個', exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(6);
      for (const [index, name] of apiOrder.entries()) {
        await expect(list.getByRole('listitem').nth(index)).toContainText(name);
      }

      for (const [contentWidth, columns] of [
        [439, 1],
        [440, 2],
      ] as const) {
        await list.evaluate((element, width) => {
          (element as HTMLElement).style.width = `${width}px`;
        }, contentWidth);
        await expect.poll(() => list.evaluate((element) => element.clientWidth)).toBe(contentWidth);
        const first = await getRect(list.getByRole('listitem').nth(0));
        const second = await getRect(list.getByRole('listitem').nth(1));
        expectAccountColumns(first, second, columns);
        widths.push({ viewportWidth, contentWidth, columns, first, second });
      }

      await list.evaluate((element) => {
        (element as HTMLElement).style.width = '440px';
      });
      await accountsCard.getByRole('button', { name: '收起', exact: true }).click();
      const firstCollapsed = await getRect(list.getByRole('listitem').nth(0));
      const secondCollapsed = await getRect(list.getByRole('listitem').nth(1));
      expectAccountColumns(firstCollapsed, secondCollapsed, 1);
      await list.evaluate((element) => {
        (element as HTMLElement).style.width = '';
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await accountsCard.getByRole('button', { name: '全部 6 個', exact: true }).click();
    await openNewTransaction(page);
    const panelListWidth = await list.evaluate((element) => element.clientWidth);
    expect(panelListWidth).toBeLessThan(440);
    await expect
      .poll(async () => {
        const [first, second] = await Promise.all([
          getRect(list.getByRole('listitem').nth(0)),
          getRect(list.getByRole('listitem').nth(1)),
        ]);
        return {
          sameColumn: Math.abs(first.x - second.x) <= 1,
          first,
          second,
          listWidth: await list.evaluate((element) => element.clientWidth),
        };
      })
      .toMatchObject({ sameColumn: true });
    const panelFirst = await getRect(list.getByRole('listitem').nth(0));
    const panelSecond = await getRect(list.getByRole('listitem').nth(1));
    expectAccountColumns(panelFirst, panelSecond, 1);

    await writeMeasurement(testInfo, {
      scenario: 'SC-Y8',
      widthMeasurements: widths,
      rightPanel: {
        viewportWidth: 1280,
        listWidth: panelListWidth,
        columns: 1,
      },
    });
  });

  test('SC-Y4 高度：趨勢圖至少 180px，卡片被同列內容撐高時圖面跟著變高', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    const categories = [setup.expenseCategory];
    for (let index = 2; index <= 12; index += 1) {
      categories.push(
        await createCategory(request, userA.token, setup.ledger.id, {
          name: `圖表高度分類 ${index}`,
          type: 'EXPENSE',
        }),
      );
    }
    for (const [index, category] of categories.entries()) {
      await createTransaction(request, userA.token, setup.ledger.id, {
        type: 'EXPENSE',
        amount: (index + 1) * 1_000,
        date: currentTaiwanDate(),
        categoryId: category.id,
        accountId: setup.account.id,
        title: `圖表高度支出 ${index + 1}`,
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const trendCard = page.locator('[data-home-card-id="trend"]');
    const categoryCard = page.locator('[data-home-card-id="categories"]');
    const svg = trendCard.locator('svg[role="group"][aria-label^="每月資產"]');
    await expect(svg).toBeVisible();
    const initialTrend = await getRect(trendCard);
    const initialSvg = await getRect(svg);
    expect(initialSvg.height).toBeGreaterThanOrEqual(180);

    await categoryCard.getByRole('button', { name: /^全部 / }).click();
    const categoryList = page.getByRole('list', { name: '支出分類' });
    await expect(categoryList.getByRole('listitem')).toHaveCount(12);
    const expandedCategoryCard = await getRect(categoryCard);
    const expandedTrend = await getRect(trendCard);
    const expandedSvg = await getRect(svg);
    expect(expandedCategoryCard.height).toBeGreaterThan(initialTrend.height);
    expect(expandedTrend.height).toBeGreaterThan(initialTrend.height);
    expect(expandedSvg.height).toBeGreaterThan(initialSvg.height);
    expect(expandedSvg.height).toBeGreaterThanOrEqual(180);

    const lastPoint = svg.locator('circle[role="button"]').last();
    await lastPoint.hover();
    const labels = svg.locator('text');
    await expect(labels).toHaveCount(2);
    const lastPointLabel = await getRect(labels.nth(1));
    const children = await expectSvgChildrenInside(svg);
    await expectFinalSegmentClearOfLabels(svg);

    await writeMeasurement(testInfo, {
      scenario: 'SC-Y4-height',
      initialTrend,
      initialSvg,
      expandedCategoryCard,
      expandedTrend,
      expandedSvg,
      lastPointLabel,
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
    const recentRowName = '日常用品';
    const recentRowCategory = categories[categories.length - 1];
    if (!recentRowCategory) throw new Error('手機驗收缺少交易分類。');
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'EXPENSE',
      amount: 2_000,
      date: currentTaiwanDate(),
      categoryId: recentRowCategory.id,
      accountId: setup.account.id,
      title: recentRowName,
    });
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

      const assetCard = page.locator('[data-home-card-id="accounts"]');
      const categorySection = page.locator('[data-home-card-id="categories"]');
      const categoryToggle = categorySection.getByRole('button', {
        name: '全部 15 類',
        exact: true,
      });
      const accountToggle = page.getByRole('button', { name: '全部 12 個', exact: true });
      const accountList = assetCard.getByRole('list', { name: '帳戶' });
      await expect(
        page
          .locator('[data-home-card-id="debts"]')
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
      const recentPanel = page.getByRole('tabpanel');
      const recentName = recentPanel.getByText(recentRowName, { exact: true });
      await expect(recentName).toBeVisible();
      const recentNameWidth = await recentName.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(recentNameWidth.scrollWidth).toBeLessThanOrEqual(recentNameWidth.clientWidth);
      const recentRow = recentName.locator('xpath=ancestor::li[1]');
      const recentRowLayout = await recentRow.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          height: element.getBoundingClientRect().height,
        };
      });
      expect(recentRowLayout).toEqual({ paddingLeft: '0px', paddingRight: '0px', height: 52 });

      await markedTab.click();
      const markedPanel = page.getByRole('tabpanel');
      await expect(markedTab).toHaveAttribute('aria-selected', 'true');
      const markedRow = markedPanel.locator('li').first();
      await expect(markedRow).toBeVisible();
      const markedRowPadding = await markedRow.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight };
      });
      expect(markedRowPadding).toEqual({ left: '0px', right: '0px' });
      const dateHeading = markedPanel.locator('div[class*="dateGroup"] > p').first();
      await expect(dateHeading).toBeVisible();
      const dateHeadingPadding = await dateHeading.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight };
      });
      expect(dateHeadingPadding).toEqual({ left: '0px', right: '0px' });
      await expect(markedTab).toHaveAttribute('aria-selected', 'true');

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
        recentNameWidth,
        recentRowLayout,
        markedRowPadding,
        dateHeadingPadding,
        tabHeights,
        categoryToggleHeight,
        accountToggleHeight,
      });
    }

    await page.setViewportSize({ width: 1280, height: 844 });
    await page.reload();
    await ensureSidebarExpanded(page);
    const desktop = await readHomeCards(page);
    expectDefaultHomeRows(desktop.cards);
    expect(Math.abs(desktop.cards.expense.width - 310)).toBeLessThanOrEqual(1);

    const desktopCategoryCard = page.locator('[data-home-card-id="categories"]');
    const desktopAccountsCard = page.locator('[data-home-card-id="accounts"]');
    const desktopDebtsCard = page.locator('[data-home-card-id="debts"]');
    await desktopCategoryCard.getByRole('button', { name: '全部 15 類', exact: true }).click();
    await desktopAccountsCard.getByRole('button', { name: '全部 12 個', exact: true }).click();
    const desktopCategoryName = page.getByText(longCategoryName, { exact: true });
    const desktopAccountList = desktopAccountsCard.getByRole('list', { name: '帳戶' });
    const desktopAccountName = desktopAccountList.getByText(longAccountName, { exact: true });
    const desktopAccountAmount = desktopAccountList.getByText('$12,345,678', { exact: true });
    const desktopDebtName = desktopDebtsCard.getByText(longPersonName, { exact: true }).first();
    for (const longValue of [
      desktopCategoryName,
      desktopAccountName,
      desktopAccountAmount,
      desktopDebtName,
    ]) {
      await expect(longValue).toBeVisible();
    }
    await expectTextInsideCard(desktopCategoryCard, desktopCategoryName);
    await expectTextInsideCard(desktopAccountsCard, desktopAccountName);
    await expectTextInsideCard(desktopAccountsCard, desktopAccountAmount);
    await expectTextInsideCard(desktopDebtsCard, desktopDebtName);
    await expectNoHorizontalPageOverflow(page);

    await page.goto('/transactions');
    const transactionPageName = page.getByText(recentRowName, { exact: true });
    await expect(transactionPageName).toBeVisible();
    const transactionPageRow = transactionPageName.locator('xpath=ancestor::li[1]');
    const transactionPageRowLayout = await transactionPageRow.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(transactionPageRowLayout).toEqual({
      paddingLeft: '16px',
      paddingRight: '16px',
      height: 52,
    });

    await writeMeasurement(testInfo, {
      scenario: 'SC-H14',
      longAccountName,
      longCategoryName,
      longPersonName,
      recentRowName,
      transactionPageRowLayout,
      measurements,
    });
  });

  test('SC-H18：淺色主題首頁配色即時切換並保留，統計頁配色不受影響', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }, testInfo) => {
    const { sharedLedger } = await prepareHomePaletteData(request, userA, userB);
    await runHomePaletteTheme(page, sharedLedger, HOME_PALETTE_THEME_OPTIONS[0], testInfo);
  });

  test('SC-H18：深色主題首頁配色即時切換並保留，統計頁配色不受影響', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }, testInfo) => {
    const { sharedLedger } = await prepareHomePaletteData(request, userA, userB);
    await runHomePaletteTheme(page, sharedLedger, HOME_PALETTE_THEME_OPTIONS[1], testInfo);
  });
  test('W7：最近卡桌機維持最小高度，390px 依內容收合', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    for (let index = 0; index < 2; index += 1) {
      await createTransaction(request, userA.token, setup.ledger.id, {
        type: 'EXPENSE',
        amount: (index + 1) * 1_000,
        date: currentTaiwanDate(),
        categoryId: setup.expenseCategory.id,
        accountId: setup.account.id,
        title: `最近卡測試 ${index + 1}`,
      });
    }

    const activityCard = page.locator('[data-home-card-id="activity"]');
    const accountsCard = page.locator('[data-home-card-id="accounts"]');
    const debtsCard = page.locator('[data-home-card-id="debts"]');
    const recentRows = page.getByRole('tabpanel').locator('li');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(recentRows).toHaveCount(2);
    const [desktopCard, desktopAccounts, desktopDebts] = await Promise.all([
      getRect(activityCard),
      getRect(accountsCard),
      getRect(debtsCard),
    ]);
    expect(Math.abs(desktopCard.y - desktopAccounts.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(desktopCard.y - desktopDebts.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(desktopCard.height - desktopAccounts.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(desktopCard.height - desktopDebts.height)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(recentRows).toHaveCount(2);
    const mobileCard = await getRect(activityCard);
    const lastRow = await getRect(recentRows.last());
    const bottomGap = mobileCard.y + mobileCard.height - (lastRow.y + lastRow.height);
    expect(bottomGap).toBeLessThanOrEqual(32);
    await writeMeasurement(testInfo, {
      scenario: 'W7-recent-card',
      desktopCard,
      desktopAccounts,
      desktopDebts,
      mobileCard,
      lastRow,
      bottomGap,
    });
  });
});

/** 為淺色與深色兩條測試建立相同的帳務資料。 */
async function prepareHomePaletteData(
  request: Parameters<typeof personalLedger>[0],
  userA: TestUser,
  userB: TestUser,
) {
  const personal = await getHomeSetup(request, userA);
  const sharedLedger = await createLedger(request, userA.token, {
    name: 'A+ 家庭共享帳本',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, sharedLedger.id, {
    email: userB.email,
    role: 'EDITOR',
  });
  const userBAccount = (await listAccounts(request, userB.token)).find(
    (account) => !account.isTemporary,
  );
  if (!userBAccount) throw new Error('展示帳號缺少可用帳戶。');
  const sharedCategories = await listCategories(request, userA.token, sharedLedger.id);
  const expenseCategory = sharedCategories.find((category) => category.type === 'EXPENSE');
  const incomeCategory = sharedCategories.find((category) => category.type === 'INCOME');
  if (!expenseCategory || !incomeCategory) throw new Error('共享帳本缺少預設收支分類。');
  const secondCategory = await createCategory(request, userA.token, sharedLedger.id, {
    name: 'A+ 展示日常用品',
    type: 'EXPENSE',
  });
  const thirdCategory = await createCategory(request, userA.token, sharedLedger.id, {
    name: 'A+ 展示交通',
    type: 'EXPENSE',
  });

  for (let index = 2; index <= 6; index += 1) {
    await createAccount(request, userA.token, {
      name: `A+ 展示帳戶 ${index}`,
      initialBalance: index * 100_000,
    });
  }

  await createTransaction(request, userA.token, sharedLedger.id, {
    type: 'EXPENSE',
    amount: 120_000,
    date: currentTaiwanDate(),
    categoryId: expenseCategory.id,
    accountId: personal.account.id,
    title: 'A+ 共享帳本餐飲支出',
  });
  await createTransaction(request, userA.token, sharedLedger.id, {
    type: 'EXPENSE',
    amount: 84_500,
    date: currentTaiwanDate(),
    categoryId: secondCategory.id,
    accountId: personal.account.id,
    title: 'A+ 共享帳本日常用品支出',
  });
  await createTransaction(request, userA.token, sharedLedger.id, {
    type: 'EXPENSE',
    amount: 53_000,
    date: currentTaiwanDate(),
    categoryId: thirdCategory.id,
    accountId: personal.account.id,
    title: 'A+ 共享帳本交通支出',
  });
  await createTransaction(request, userA.token, sharedLedger.id, {
    type: 'INCOME',
    amount: 260_000,
    date: currentTaiwanDate(),
    categoryId: incomeCategory.id,
    accountId: personal.account.id,
    title: 'A+ 共享帳本收入',
  });
  await createDebtEntry(request, userA.token, {
    counterparty: { name: '展示對象欠我' },
    kind: 'LEND',
    amount: 24_560,
    date: currentTaiwanDate(),
    record: { ledgerId: sharedLedger.id, accountId: personal.account.id },
  });
  await createDebtEntry(request, userA.token, {
    counterparty: { name: '展示對象我欠' },
    kind: 'BORROW',
    amount: 7_890,
    date: currentTaiwanDate(),
    record: { ledgerId: sharedLedger.id, accountId: personal.account.id },
  });
  const linked = await linkByEmail(request, userB, userA);
  await createDebtEntry(request, userB.token, {
    counterparty: { id: linked.inviterSideId },
    kind: 'LEND',
    amount: 18_300,
    date: currentTaiwanDate(),
    record: { ledgerId: sharedLedger.id, accountId: userBAccount.id },
  });
  const overpaid = await createDebtEntry(request, userB.token, {
    counterparty: { name: '展示差額付款人' },
    kind: 'BORROW',
    amount: 7_000,
    date: currentTaiwanDate(),
    record: { ledgerId: sharedLedger.id, accountId: userBAccount.id },
  });
  await createDebtEntry(request, userB.token, {
    counterparty: { id: overpaid.counterparty.id },
    kind: 'REPAYMENT',
    amount: 8_200,
    settle: true,
    date: currentTaiwanDate(),
    record: { ledgerId: sharedLedger.id, accountId: userBAccount.id },
  });
  return { sharedLedger };
}

/** 驗證單一主題下三種首頁配色。 */
async function runHomePaletteTheme(
  page: Page,
  sharedLedger: Awaited<ReturnType<typeof createLedger>>,
  themeOption: HomePaletteThemeOption,
  testInfo: TestInfo,
): Promise<void> {
  const options = [themeOption];
  const statisticsColorByTheme = new Map<string, string>();
  const screenshots: string[] = [];
  const measurements = [];

  await mkdir(APLUS_SHOTS_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const ledgerSwitcher = page.getByRole('group', { name: '作用中帳本' });
  await ledgerSwitcher.getByRole('button').click();
  await page.locator(`[role="option"] [data-ledger-name="${sharedLedger.name}"]`).click();
  await expect(ledgerSwitcher.getByRole('button')).toContainText(sharedLedger.name);
  await expect(page.locator('[data-home-card-id="categories"]')).toContainText('未分類');

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
      await expect(page.locator('[data-home-card-id="categories"]')).toContainText('未分類');
      await expect(page.locator('html')).toHaveAttribute('data-theme', themeOption.theme);
      await expect.poll(() => readHomeCategoryColor(page)).toBe(homeColorBeforeReload);

      const accountCard = page.locator('[data-home-card-id="accounts"]');
      await accountCard.getByRole('button', { name: '全部 6 個', exact: true }).click();
      await expect(
        accountCard.getByRole('list', { name: '帳戶' }).getByRole('listitem'),
      ).toHaveCount(6);
      await expect(page.locator('[data-home-card-id="debts"]')).toContainText('展示對象欠我');
      await expect(page.locator('[data-home-card-id="debts"]')).toContainText('展示對象我欠');

      const screenshotsForMode: string[] = [];
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        if (width === 390) {
          await expect(page.locator('[data-home-layout="narrow"]')).toBeVisible();
          await expectNoHorizontalPageOverflow(page);
        }
        const path = join(
          APLUS_SHOTS_DIR,
          `home-${width}px-${themeOption.theme}-${mode.value}.png`,
        );
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        screenshots.push(path);
        screenshotsForMode.push(path);
      }

      await page.goto(
        `/stats?tab=cat&ledger=${encodeURIComponent(sharedLedger.id)}&month=${currentTaiwanMonth()}`,
      );
      await expect(
        page.getByRole('heading', { level: 2, name: '統計', exact: true }),
      ).toBeVisible();
      const statisticsColor = await readStatisticsCategoryColor(page);
      const existingColor = statisticsColorByTheme.get(themeOption.theme);
      if (existingColor === undefined)
        statisticsColorByTheme.set(themeOption.theme, statisticsColor);
      else expect(statisticsColor).toBe(existingColor);

      await page.setViewportSize({ width: 1280, height: 900 });
      await openDashboard(page);
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
}

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
  const incomeCategory = categories.find((item) => item.type === 'INCOME');
  if (!expenseCategory || !incomeCategory) throw new Error('測試帳本缺少預設分類。');
  return { ledger, account, expenseCategory, incomeCategory };
}

async function ensureSidebarExpanded(page: Page): Promise<void> {
  const expandButton = page.getByRole('button', { name: '展開側欄', exact: true });
  if (await expandButton.isVisible()) await expandButton.click();
  await expect(page.getByRole('button', { name: '收合側欄', exact: true })).toBeVisible();
}

async function readCardIds(layout: Locator): Promise<HomeCardId[]> {
  const ids = await layout
    .locator('[data-home-card-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-home-card-id')),
    );
  return ids.map((id) => {
    if (id === null || !HOME_CARD_IDS.includes(id as HomeCardId)) {
      throw new Error(`首頁出現未登記的卡片 id：${id ?? '(空)'}`);
    }
    return id as HomeCardId;
  });
}

type HomeLayoutKind = 'tree' | 'narrow';

async function readHomeCards(
  page: Page,
  layoutKind: HomeLayoutKind = 'tree',
): Promise<{
  layout: Rect;
  cardIds: HomeCardId[];
  cards: Record<HomeCardId, Rect>;
}> {
  const layout = page.locator(`[data-home-layout="${layoutKind}"]`);
  await expect(layout).toBeVisible();
  const cards = {} as Record<HomeCardId, Rect>;
  for (const cardId of HOME_CARD_IDS) {
    cards[cardId] = await getRect(layout.locator(`[data-home-card-id="${cardId}"]`));
  }
  return { layout: await getRect(layout), cardIds: await readCardIds(layout), cards };
}

type HomeCardsSnapshot = Awaited<ReturnType<typeof readHomeCards>>;

/** ResizeObserver 重排非同步；等完整卡片方框與列斷言同時通過再回傳快照。 */
async function waitForHomeCards(
  page: Page,
  verify: (snapshot: HomeCardsSnapshot) => void,
  layoutKind: HomeLayoutKind = 'tree',
): Promise<HomeCardsSnapshot> {
  let snapshot: HomeCardsSnapshot | undefined;
  await expect(async () => {
    snapshot = await readHomeCards(page, layoutKind);
    verify(snapshot);
  }).toPass({ timeout: 5_000 });
  if (!snapshot) throw new Error('首頁卡片版面尚未穩定。');
  return snapshot;
}

async function ensureSidebarCollapsed(page: Page): Promise<void> {
  const expandButton = page.getByRole('button', { name: '展開側欄', exact: true });
  if (!(await expandButton.isVisible())) {
    await page.getByRole('button', { name: '收合側欄', exact: true }).click();
  }
  await expect(expandButton).toBeVisible();
}

/** 強制頁面有垂直捲動後量實際捲軸與 stable 保留區，合併得到排版可用寬度的總扣除量。 */
async function measureViewportInset(page: Page): Promise<{
  scrollbarWidth: number;
  stableGutterWidth: number;
  layoutGutterWidth: number;
}> {
  await page.addStyleTag({ content: 'html { min-height: 200vh; }' });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
      ),
    )
    .toBe(true);
  return page.evaluate(() => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const stableGutterWidth =
      document.documentElement.clientWidth - document.documentElement.getBoundingClientRect().width;
    return {
      scrollbarWidth,
      stableGutterWidth,
      layoutGutterWidth: scrollbarWidth + stableGutterWidth,
    };
  });
}

function expectDefaultHomeRows(cards: Record<HomeCardId, Rect>): void {
  expectCardRows(cards, [
    ['expense', 'income', 'net'],
    ['trend', 'categories'],
    ['activity', 'accounts', 'debts'],
  ]);
  expectWidthsEqual(cards, ['expense', 'income', 'net']);
  expect(Math.abs(cards.trend.width - 2 * cards.categories.width)).toBeLessThanOrEqual(2);
  expectWidthsEqual(cards, ['activity', 'accounts', 'debts']);
}

function expectCardRows(
  cards: Record<HomeCardId, Rect>,
  rows: readonly (readonly HomeCardId[])[],
): void {
  for (const row of rows) {
    const first = cards[row[0]!];
    for (const cardId of row.slice(1)) {
      expect(Math.abs(cards[cardId].y - first.y)).toBeLessThanOrEqual(2);
      expect(cards[cardId].x).toBeGreaterThanOrEqual(first.x - 2);
    }
  }
  for (let index = 1; index < rows.length; index += 1) {
    const previous = cards[rows[index - 1]![0]!];
    const current = cards[rows[index]![0]!];
    expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height - 2);
  }
}

function expectWidthsEqual(cards: Record<HomeCardId, Rect>, cardIds: readonly HomeCardId[]): void {
  const widths = cardIds.map((cardId) => cards[cardId].width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
}

function expectCardRectsClose(
  actual: Record<HomeCardId, Rect>,
  expected: Record<HomeCardId, Rect>,
): void {
  for (const cardId of HOME_CARD_IDS) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(actual[cardId][dimension] - expected[cardId][dimension])).toBeLessThanOrEqual(
        2,
      );
    }
  }
}

function expectAccountColumns(first: Rect, second: Rect, columns: 1 | 2): void {
  if (columns === 1) {
    expect(second.y).toBeGreaterThan(first.y);
  } else {
    expect(second.x).toBeGreaterThan(first.x);
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
  }
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectFinalSegmentClearOfLabels(svg: Locator) {
  const distances = await svg.evaluate((element) => {
    type Point = { x: number; y: number };
    type Box = { x: number; y: number; width: number; height: number };

    const points = Array.from(element.querySelectorAll('circle[role="button"]'));
    const labels = Array.from(element.querySelectorAll('text')).slice(0, 2);
    const previous = points.at(-2);
    const final = points.at(-1);
    if (!previous || !final || labels.length !== 2) {
      throw new Error('資產趨勢圖缺少最後一段折線或標籤。');
    }

    const start = {
      x: Number(previous.getAttribute('cx')),
      y: Number(previous.getAttribute('cy')),
    };
    const end = { x: Number(final.getAttribute('cx')), y: Number(final.getAttribute('cy')) };
    const segmentIntersectsRect = (rect: Box) => {
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      let minimumRatio = 0;
      let maximumRatio = 1;
      const clipping: Array<[number, number]> = [
        [-deltaX, start.x - rect.x],
        [deltaX, rect.x + rect.width - start.x],
        [-deltaY, start.y - rect.y],
        [deltaY, rect.y + rect.height - start.y],
      ];

      for (const [direction, distance] of clipping) {
        if (direction === 0) {
          if (distance < 0) return false;
          continue;
        }
        const ratio = distance / direction;
        if (direction < 0) minimumRatio = Math.max(minimumRatio, ratio);
        else maximumRatio = Math.min(maximumRatio, ratio);
        if (minimumRatio > maximumRatio) return false;
      }
      return true;
    };
    const pointToSegmentDistance = (point: Point, segmentStart: Point, segmentEnd: Point) => {
      const deltaX = segmentEnd.x - segmentStart.x;
      const deltaY = segmentEnd.y - segmentStart.y;
      const lengthSquared = deltaX * deltaX + deltaY * deltaY;
      const ratio =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.x - segmentStart.x) * deltaX + (point.y - segmentStart.y) * deltaY) /
                  lengthSquared,
              ),
            );
      return Math.hypot(
        point.x - (segmentStart.x + ratio * deltaX),
        point.y - (segmentStart.y + ratio * deltaY),
      );
    };
    const segmentToSegmentDistance = (
      firstStart: Point,
      firstEnd: Point,
      secondStart: Point,
      secondEnd: Point,
    ) =>
      Math.min(
        pointToSegmentDistance(firstStart, secondStart, secondEnd),
        pointToSegmentDistance(firstEnd, secondStart, secondEnd),
        pointToSegmentDistance(secondStart, firstStart, firstEnd),
        pointToSegmentDistance(secondEnd, firstStart, firstEnd),
      );
    return labels.map((label) => {
      const rect = label.getBBox();
      const rectangleEdges: Array<[Point, Point]> = [
        [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
        ],
        [
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width, y: rect.y + rect.height },
        ],
        [
          { x: rect.x + rect.width, y: rect.y + rect.height },
          { x: rect.x, y: rect.y + rect.height },
        ],
        [
          { x: rect.x, y: rect.y + rect.height },
          { x: rect.x, y: rect.y },
        ],
      ];
      const distance = segmentIntersectsRect(rect)
        ? 0
        : Math.min(
            ...rectangleEdges.map(([edgeStart, edgeEnd]) =>
              segmentToSegmentDistance(start, end, edgeStart, edgeEnd),
            ),
          );
      return { label: label.textContent, distance };
    });
  });
  for (const { label, distance } of distances) {
    expect(distance, `最後一段折線與「${label ?? ''}」標籤的距離`).toBeGreaterThan(0);
  }
  return distances;
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

async function expectTextInsideCard(card: Locator, text: Locator): Promise<void> {
  const [cardBox, textBox] = await Promise.all([getRect(card), getRect(text)]);
  expect(textBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
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
