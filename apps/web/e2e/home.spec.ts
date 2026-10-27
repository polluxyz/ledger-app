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
  listLedgerPeople,
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

interface ActivityRowCase {
  name: string;
  badge?: 'cleared' | 'split';
  expand?: boolean;
  temporaryAccount?: boolean;
}

interface MeasuredBox extends Rect {
  right: number;
  bottom: number;
}

interface HomeActivityRowGeometry {
  row: MeasuredBox;
  icon: MeasuredBox;
  category: MeasuredBox;
  name: { box: MeasuredBox; text: string; clientWidth: number; scrollWidth: number };
  amount: MeasuredBox;
  badges: MeasuredBox[];
  actions: MeasuredBox;
  controls: MeasuredBox[];
  details: MeasuredBox | null;
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
  test('SC-V1～V4：資產與帳本結餘切換、動畫、鍵盤及手機版', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    const setup = await getHomeSetup(request, userA);
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'INCOME',
      amount: 500000,
      date: currentTaiwanDate(),
      categoryId: setup.incomeCategory.id,
      accountId: setup.account.id,
      title: '財務趨勢驗收收入',
    });
    await createTransaction(request, userA.token, setup.ledger.id, {
      type: 'EXPENSE',
      amount: 125000,
      date: currentTaiwanDate(),
      categoryId: setup.expenseCategory.id,
      accountId: setup.account.id,
      title: '財務趨勢驗收支出',
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    const card = page.locator('[data-home-card-id="trend"]');
    const assets = card.getByRole('button', { name: '總資產變化', exact: true }),
      net = card.getByRole('button', { name: '每月結餘', exact: true });
    await expect(assets).toHaveAttribute('aria-pressed', 'true');
    expect(
      await card.getByRole('group', { name: '趨勢指標' }).getByRole('button').allTextContents(),
    ).toEqual(['總資產變化', '每月結餘']);
    await expect(card.locator('[data-trend-bar]')).toHaveCount(12);
    await net.click();
    await expect(card.getByLabel('本月結餘 $3,750', { exact: true })).toBeVisible();
    await expect(card.locator('svg')).not.toHaveAttribute('data-animating', 'true');
    const month = card.locator('g[role="button"]').first();
    await month.focus();
    await page.keyboard.press('ArrowRight');
    await expect(card.locator('g[role="button"]').nth(1)).toBeFocused();
    await assets.click();
    await net.click();
    await assets.click();
    await expect(assets).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('svg')).not.toHaveAttribute('data-animating', 'true');
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'off'));
    await net.click();
    await expect(card.locator('svg')).not.toHaveAttribute('data-animating', 'true');
    await expect(card.getByLabel('本月結餘 $3,750', { exact: true })).toBeVisible();
    for (const width of [390, 309]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('[data-home-layout="narrow"]')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await expectNoHorizontalPageOverflow(page);
      await expect(card.locator('[data-trend-bar]')).toHaveCount(12);
    }
    await page.screenshot({
      path: testInfo.outputPath('home-financial-trend-mobile.png'),
      fullPage: true,
    });
  });

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
    const desktop = await waitForHomeCards(page, (snapshot) => {
      expect(snapshot.cardIds).toEqual(HOME_CARD_IDS);
    });
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
    const finalTrendPoint = trend.locator('g[role="button"]').last();
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
      expectCardRectsClose(snapshot.cards, justFits.cards);
    });

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

  test('SC-Y8：六個帳戶依 439px／440px 容器寬換欄，五個以下保持一欄', async ({
    signedInPage: page,
    userA,
    request,
  }, testInfo) => {
    for (let index = 2; index <= 5; index += 1) {
      await createAccount(request, userA.token, {
        name: `首頁帳戶 ${String(index).padStart(2, '0')}`,
      });
    }
    await page.reload();

    const accountsCard = page.locator('[data-home-card-id="accounts"]');
    const list = accountsCard.getByRole('list', { name: '帳戶' });
    const fiveAccountApiOrder = (await listAccounts(request, userA.token))
      .filter((account) => !account.isTemporary || account.hasTransactions)
      .map((account) => account.name);
    expect(fiveAccountApiOrder).toHaveLength(5);
    await expect(list.getByRole('listitem')).toHaveCount(5);
    for (const [index, name] of fiveAccountApiOrder.entries()) {
      await expect(list.getByRole('listitem').nth(index)).toContainText(name);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await list.evaluate((element) => {
      (element as HTMLElement).style.width = '440px';
    });
    await expect.poll(() => list.evaluate((element) => element.clientWidth)).toBe(440);
    const fiveAccountFirst = await getRect(list.getByRole('listitem').nth(0));
    const fiveAccountSecond = await getRect(list.getByRole('listitem').nth(1));
    expectAccountColumns(fiveAccountFirst, fiveAccountSecond, 1);
    await list.evaluate((element) => {
      (element as HTMLElement).style.width = '';
    });

    await createAccount(request, userA.token, { name: '首頁帳戶 06' });
    await page.reload();
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
        (element as HTMLElement).style.width = '';
      });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    const homeLayout = page.locator('[data-home-layout="tree"]');
    let previousHomeContentWidth: number | undefined;
    let stableHomeContentWidth: number | undefined;
    await expect
      .poll(async () => {
        const width = await homeLayout.evaluate((element) => element.clientWidth);
        const widthIsStable = previousHomeContentWidth === width;
        previousHomeContentWidth = width;
        if (widthIsStable) stableHomeContentWidth = width;
        return widthIsStable;
      })
      .toBe(true);
    if (stableHomeContentWidth === undefined) {
      throw new Error('新增交易面板開啟前的首頁內容寬度尚未穩定。');
    }
    const homeContentWidthBeforePanel = stableHomeContentWidth;
    await openNewTransaction(page);
    const rightPanel = page.locator('[data-registered][data-open]');
    let previousListWidth: number | undefined;
    let stablePanelLayout:
      | {
          listWidth: number;
          columns: 1 | 2;
          first: Rect;
          second: Rect;
          homeContentWidth: number;
        }
      | undefined;
    // 面板寬度轉場中會量到暫時的一欄，所以要等清單寬度穩定且面板到位再判斷。
    await expect
      .poll(async () => {
        const [listWidth, panelWidths] = await Promise.all([
          list.evaluate((element) => element.clientWidth),
          rightPanel.evaluate((element) => {
            const inner = element.firstElementChild;
            if (!(inner instanceof HTMLElement)) {
              throw new Error('新增交易右側面板缺少內層容器。');
            }
            return {
              current: element.getBoundingClientRect().width,
              final: inner.getBoundingClientRect().width,
            };
          }),
        ]);
        const listWidthStable = previousListWidth === listWidth;
        previousListWidth = listWidth;
        const panelAtFinalWidth = Math.abs(panelWidths.current - panelWidths.final) <= 1;
        if (listWidthStable && panelAtFinalWidth) {
          const [first, second, homeContentWidth] = await Promise.all([
            getRect(list.getByRole('listitem').nth(0)),
            getRect(list.getByRole('listitem').nth(1)),
            homeLayout.evaluate((element) => element.clientWidth),
          ]);
          stablePanelLayout = {
            listWidth,
            columns: listWidth >= 440 ? 2 : 1,
            first,
            second,
            homeContentWidth,
          };
        }
        return {
          listWidthStable,
          panelAtFinalWidth,
        };
      })
      .toMatchObject({ listWidthStable: true, panelAtFinalWidth: true });
    if (!stablePanelLayout) throw new Error('新增交易面板的帳戶清單尚未穩定量測。');
    const {
      listWidth: panelListWidth,
      columns: panelColumns,
      first: panelFirst,
      second: panelSecond,
      homeContentWidth: homeContentWidthWithPanel,
    } = stablePanelLayout;
    expect(homeContentWidthWithPanel).toBeLessThan(homeContentWidthBeforePanel);
    expectAccountColumns(panelFirst, panelSecond, panelColumns);

    await writeMeasurement(testInfo, {
      scenario: 'SC-Y8',
      fiveAccountWideCard: {
        contentWidth: 440,
        columns: 1,
        first: fiveAccountFirst,
        second: fiveAccountSecond,
      },
      widthMeasurements: widths,
      rightPanel: {
        viewportWidth: 1280,
        listWidth: panelListWidth,
        columns: panelColumns,
        homeContentWidthBeforePanel,
        homeContentWidthWithPanel,
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

    const lastPoint = svg.locator('g[role="button"]').last();
    await lastPoint.hover();
    const labels = svg.locator('text');
    await expect(svg.locator('g[role="button"]')).toHaveCount(12);
    const lastPointLabel = await getRect(labels.last());
    const children = await expectSvgChildrenInside(svg);

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
      await expect(accountList.getByRole('listitem')).toHaveCount(12);
      await categoryToggle.click();
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
      expect(recentRowLayout.paddingLeft).toBe('0px');
      expect(recentRowLayout.paddingRight).toBe('0px');
      expect(recentRowLayout.height).toBeGreaterThanOrEqual(52);

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
        const rect = await getRect(tab);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        tabHeights.push(rect.height);
      }
      const categoryToggleHeight = (
        await getRect(categorySection.getByRole('button', { name: '收起', exact: true }))
      ).height;
      expect(categoryToggleHeight).toBeGreaterThanOrEqual(44);

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
    const desktopCategoryName = page.getByText(longCategoryName, { exact: true });
    const desktopAccountList = desktopAccountsCard.getByRole('list', { name: '帳戶' });
    await expect(desktopAccountList.getByRole('listitem')).toHaveCount(12);
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

  test('SC-Y30：窄 activity 卡的最近與標註列保留名稱、金額、徽章與操作', async ({
    signedInPage: initialPage,
    userA,
    userB,
    request,
    openAs,
  }, testInfo) => {
    let page = initialPage;
    const ledger = await createLedger(request, userA.token, {
      name: 'SC-Y30 activity 列',
      kind: 'SHARED',
    });
    await addMember(request, userA.token, ledger.id, {
      email: userB.email,
      role: 'EDITOR',
    });

    const [accounts, categories, people] = await Promise.all([
      listAccounts(request, userA.token),
      listCategories(request, userA.token, ledger.id),
      listLedgerPeople(request, userA.token, ledger.id),
    ]);
    const account = accounts.find((item) => item.name === '現金' && !item.isTemporary);
    const expenseCategory = categories.find((category) => category.type === 'EXPENSE');
    const self = people.find((person) => person.userId === userA.id);
    const otherMember = people.find((person) => person.userId === userB.id);
    if (!account || !expenseCategory || !self || !otherMember) {
      throw new Error('SC-Y30 前置資料缺少現金帳戶、支出分類或共享帳本成員。');
    }

    const date = currentTaiwanDate();
    const record = { ledgerId: ledger.id, accountId: account.id };
    const shares = {
      method: 'EQUAL' as const,
      shares: [{ personId: self.id }, { personId: otherMember.id }],
    };

    // 分帳列先建立，讓最近頁的 5 筆上限保留短借、差額還清與展開列等窄卡關鍵案例。
    const splitRow = await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 10_000,
      date,
      title: '分帳',
      categoryId: expenseCategory.id,
      accountId: account.id,
      ledgerSplit: shares,
    });
    const markedRow = await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 11_000,
      date,
      title: '標註',
      categoryId: expenseCategory.id,
      accountId: account.id,
    });
    const shortDebt = await createDebtEntry(request, userA.token, {
      counterparty: { name: '短友' },
      kind: 'BORROW',
      amount: 6_000,
      date,
      title: '短借',
      record,
    });
    const shortDebtId = shortDebt.entries[0]?.transactionId;
    if (!shortDebtId) throw new Error('SC-Y30 短借紀錄沒有產生交易。');

    const differenceRepayment = await createDebtEntry(request, userA.token, {
      counterparty: { id: shortDebt.counterparty.id },
      kind: 'REPAYMENT',
      amount: 6_500,
      settle: true,
      date,
      title: '差額',
      record,
    });
    const differenceRepaymentId = differenceRepayment.entries[0]?.transactionId;
    if (!differenceRepaymentId) throw new Error('SC-Y30 差額還清沒有產生交易。');

    const temporaryAccountRow = await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 7_000,
      date,
      title: '代付',
      categoryId: expenseCategory.id,
      payerPersonId: otherMember.id,
    });
    const expandedRow = await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 12_000,
      date,
      title: '細項',
      categoryId: expenseCategory.id,
      payerPersonId: otherMember.id,
      ledgerSplit: shares,
    });

    for (const transactionId of [
      splitRow.id,
      markedRow.id,
      shortDebtId,
      differenceRepaymentId,
      temporaryAccountRow.id,
      expandedRow.id,
    ]) {
      await markTransaction(request, userA.token, ledger.id, transactionId);
      await markTransaction(request, userB.token, ledger.id, transactionId);
    }

    // B 是代付列的付款人，因此他的檢視會顯示本人待補的臨時帳戶操作。
    page = await openAs(userB);

    const rowCases: ActivityRowCase[] = [
      { name: '短借' },
      { name: '差額', badge: 'cleared' },
      { name: '代付', temporaryAccount: true },
      { name: '分帳', badge: 'split' },
      { name: '標註' },
      { name: '細項', badge: 'split', expand: true, temporaryAccount: true },
    ];
    // 最近頁固定只呈現 RECENT_LIMIT=5 筆，量它實際顯示的五列；標註頁則檢查全部六種案例。
    const recentRowCases = rowCases.filter(({ name }) => name !== '分帳');
    const viewportCases = [
      { name: '309px', width: 1280, layout: 'tree' as const },
      { name: '390px', width: 390, layout: 'narrow' as const },
      { name: 'wide-card', width: 900, layout: 'narrow' as const },
    ];
    const screenshots: string[] = [];
    const measurements: unknown[] = [];
    await mkdir(testInfo.outputDir, { recursive: true });

    async function selectTestLedger(): Promise<void> {
      await expect(page.locator('[data-home-card-id="activity"]')).toBeVisible();
      const switcher = page.getByRole('group', { name: '作用中帳本' });
      await switcher.getByRole('button').click();
      await page.locator(`[role="option"] [data-ledger-name="${ledger.name}"]`).click();
      await expect(switcher.getByRole('button')).toContainText(ledger.name);
    }

    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate((value) => window.localStorage.setItem('ledger.theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await ensureSidebarExpanded(page);
      await selectTestLedger();

      for (const viewport of viewportCases) {
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await waitForHomeCards(
          page,
          (current) => {
            if (viewport.width === 1280) {
              expectDefaultHomeRows(current.cards);
              expect(Math.abs(current.cards.activity.width - 309)).toBeLessThanOrEqual(1);
            }
            if (viewport.width === 900) expect(current.cards.activity.width).toBeGreaterThan(400);
          },
          viewport.layout,
        );
        const activityCard = page.locator('[data-home-card-id="activity"]');
        if (viewport.width === 390) {
          await expect(page.locator('[data-home-layout="narrow"]')).toBeVisible();
          await expectNoHorizontalPageOverflow(page);
        }

        const recentTab = activityCard.getByRole('tab', { name: '最近', exact: true });
        const markedTab = activityCard.getByRole('tab', { name: /^標註/ });
        const tabCases = [
          { name: 'recent', tab: recentTab, rows: recentRowCases },
          { name: 'marked', tab: markedTab, rows: rowCases },
        ];
        for (const tabCase of tabCases) {
          await tabCase.tab.click();
          await expect(tabCase.tab).toHaveAttribute('aria-selected', 'true');
          const panel = activityCard.getByRole('tabpanel');
          await expect(panel).toBeVisible();
          await activityCard.scrollIntoViewIfNeeded();
          const cardBox = await getRect(activityCard);
          await expect(panel.locator('[data-home-activity-part="name"]')).toHaveCount(
            tabCase.rows.length,
          );

          const rowMeasurements = [];
          for (const rowCase of tabCase.rows) {
            const namePart = panel
              .locator('[data-home-activity-part="name"]')
              .filter({ hasText: rowCase.name });
            await expect(namePart).toHaveCount(1);
            await expect(namePart).toHaveText(rowCase.name);
            const row = namePart.locator('xpath=ancestor::li[1]');
            await expect(row).toBeVisible();
            await expect(row.locator('[data-home-activity-part="category"]')).toBeVisible();
            await expect(row.locator('[data-home-activity-part="amount"]')).toBeVisible();
            await expect(row.locator('[data-home-activity-part="actions"]')).toBeVisible();

            if (rowCase.temporaryAccount) {
              await expect(row.getByRole('button', { name: '臨時帳戶' })).toBeVisible();
            }

            if (rowCase.badge === 'cleared') {
              await expect(row.locator('[class*="clearedBadge"]')).toBeVisible();
            }
            if (rowCase.badge === 'split') {
              await expect(row.locator('[class*="splitBadge"]')).toBeVisible();
            }
            if (rowCase.expand) {
              await row.getByRole('button', { name: '展開分帳明細' }).click();
              await expect(row.getByRole('button', { name: '收合分帳明細' })).toHaveAttribute(
                'aria-expanded',
                'true',
              );
              await expect(row.locator('[data-home-activity-part="details"]')).toBeVisible();
            }

            const geometry = await measureHomeActivityRow(row);
            expect(geometry.category.width).toBeGreaterThan(0);
            expect(geometry.name.box.width).toBeGreaterThan(0);
            expect(geometry.amount.width).toBeGreaterThan(0);
            expect([...rowCase.name]).toHaveLength(2);
            expect(geometry.name.scrollWidth).toBeLessThanOrEqual(geometry.name.clientWidth);
            expectActivityRowGeometry(geometry, cardBox);
            rowMeasurements.push({ name: rowCase.name, geometry });
          }

          const screenshotPath = testInfo.outputPath(
            `home-activity-${viewport.name}-${theme}-${tabCase.name}.png`,
          );
          await activityCard.screenshot({ path: screenshotPath, animations: 'disabled' });
          screenshots.push(screenshotPath);
          measurements.push({
            viewport: viewport.name,
            viewportWidth: viewport.width,
            theme,
            tab: tabCase.name,
            card: cardBox,
            rows: rowMeasurements,
            screenshot: screenshotPath,
          });
        }
      }
    }

    await writeMeasurement(testInfo, { scenario: 'SC-Y30', screenshots, measurements });
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
      expect(
        Math.abs(actual[cardId][dimension] - expected[cardId][dimension]),
        `${cardId}.${dimension}: actual=${actual[cardId][dimension]}, expected=${expected[cardId][dimension]}`,
      ).toBeLessThanOrEqual(2);
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

async function expectSvgChildrenInside(svg: Locator) {
  const svgBox = await getRect(svg);
  const points = svg.locator('g[role="button"]');
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
  // 視窗或側欄剛改變版面時，元素可能短暫沒有方框；重試整個定位與量測流程。
  let rect: Rect | null = null;
  await expect(async () => {
    const measuredRect = await locator.boundingBox();
    expect(measuredRect).not.toBeNull();
    if (!measuredRect) throw new Error('無法取得首頁元件的實際方框。');
    rect = measuredRect;
  }).toPass({ timeout: 5_000 });
  if (!rect) throw new Error('無法取得首頁元件的實際方框。');
  return rect;
}

/** 以真實 DOM 方框檢查窄版首頁列的可用空間、文字截斷與重疊。 */
async function measureHomeActivityRow(row: Locator): Promise<HomeActivityRowGeometry> {
  return row.evaluate((element) => {
    function part(name: string): HTMLElement {
      const target = element.querySelector<HTMLElement>(`[data-home-activity-part="${name}"]`);
      if (!target) throw new Error(`首頁交易列缺少 ${name} 元素。`);
      return target;
    }

    function box(target: Element): MeasuredBox {
      const rect = target.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    }

    const name = part('name');
    const actions = part('actions');
    const details = element.querySelector<HTMLElement>('[data-home-activity-part="details"]');
    return {
      row: box(element),
      icon: box(part('icon')),
      category: box(part('category')),
      name: {
        box: box(name),
        text: name.textContent?.trim() ?? '',
        clientWidth: name.clientWidth,
        scrollWidth: name.scrollWidth,
      },
      amount: box(part('amount')),
      badges: Array.from(
        element.querySelectorAll<HTMLElement>('[data-home-activity-part="badge"]'),
      ).map(box),
      actions: box(actions),
      controls: Array.from(actions.querySelectorAll('button')).map(box),
      details: details ? box(details) : null,
    };
  });
}

function expectActivityRowGeometry(geometry: HomeActivityRowGeometry, card: Rect): void {
  const boxes = [
    { name: '整列', box: geometry.row },
    { name: '圖示', box: geometry.icon },
    { name: '分類', box: geometry.category },
    { name: '名稱', box: geometry.name.box },
    ...geometry.badges.map((box, index) => ({ name: `徽章 ${index + 1}`, box })),
    { name: '金額', box: geometry.amount },
    ...geometry.controls.map((box, index) => ({ name: `操作 ${index + 1}`, box })),
    ...(geometry.details ? [{ name: '展開細項', box: geometry.details }] : []),
  ];
  const cardRight = card.x + card.width;
  const cardBottom = card.y + card.height;
  for (const item of boxes) {
    expect(item.box.width, `${item.name} 寬度`).toBeGreaterThan(0);
    expect(item.box.x, `${item.name} 超出卡片左側`).toBeGreaterThanOrEqual(card.x - 1);
    expect(item.box.right, `${item.name} 超出卡片右側`).toBeLessThanOrEqual(cardRight + 1);
    expect(item.box.y, `${item.name} 超出卡片上方`).toBeGreaterThanOrEqual(card.y - 1);
    expect(item.box.bottom, `${item.name} 超出卡片下方`).toBeLessThanOrEqual(cardBottom + 1);
  }
  expect(geometry.controls.length).toBeGreaterThan(0);
  expect(geometry.actions.width).toBeGreaterThan(0);
  const amountActionsOverlap =
    geometry.amount.x < geometry.actions.right - 0.5 &&
    geometry.amount.right > geometry.actions.x + 0.5 &&
    geometry.amount.y < geometry.actions.bottom - 0.5 &&
    geometry.amount.bottom > geometry.actions.y + 0.5;
  expect(amountActionsOverlap, '金額與操作不得重疊').toBe(false);
  const amountCenterY = geometry.amount.y + geometry.amount.height / 2;
  const actionsCenterY = geometry.actions.y + geometry.actions.height / 2;
  expect(Math.abs(amountCenterY - actionsCenterY), '金額與操作要排在同一行').toBeLessThanOrEqual(1);
  if (geometry.details) {
    expect(geometry.details.y).toBeGreaterThanOrEqual(geometry.actions.bottom - 1);
  }

  for (let firstIndex = 1; firstIndex < boxes.length; firstIndex += 1) {
    const first = boxes[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
      const second = boxes[secondIndex]!;
      const overlaps =
        first.box.x < second.box.right - 0.5 &&
        first.box.right > second.box.x + 0.5 &&
        first.box.y < second.box.bottom - 0.5 &&
        first.box.bottom > second.box.y + 0.5;
      expect(overlaps, `${first.name} 與 ${second.name} 不得重疊`).toBe(false);
    }
  }
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
