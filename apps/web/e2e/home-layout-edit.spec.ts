import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { createLedger, getHomeLayout, putHomeLayout, TEST_PASSWORD, type TestUser } from './api';
import {
  eightCardsInOneRow,
  expectCardOrder,
  layoutAtMaximumDepth,
  movePointerToCardSide,
  nestedWrappingLayout,
  nodeShape,
  wideCategoriesDefaultLayout,
  watchHomeLayoutRequests,
} from './home-layout-edit-helpers';
import { newTransactionForm, openUserMenu, switchLedger } from './ui';
import {
  DEFAULT_HOME_LAYOUT_V1,
  parseHomeLayoutV1,
  type HomeCardId,
  type HomeLayoutResponse,
  type HomeLayoutV1,
} from '@ledger/shared';

const ALL_CARD_IDS: readonly HomeCardId[] = [
  'expense',
  'income',
  'net',
  'trend',
  'categories',
  'activity',
  'accounts',
  'debts',
];

const HOME_CARD_TITLES: Record<HomeCardId, string> = {
  expense: '本月支出',
  income: '本月收入',
  net: '本月結餘',
  trend: '財務趨勢',
  categories: '本月支出',
  activity: '最近｜標註',
  accounts: '帳戶',
  debts: '借還',
};

const resizeObserverErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  resizeObserverErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error' && /ResizeObserver loop/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (/ResizeObserver loop/i.test(error.message)) errors.push(error.message);
  });
});

test.afterEach(({ page }) => {
  expect(resizeObserverErrors.get(page) ?? []).toEqual([]);
});

async function enterEditor(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  const cardHeights = await page
    .locator('[data-home-card-id]')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  expect(cardHeights).toHaveLength(8);
  expect(cardHeights.every((height) => height > 0)).toBe(true);
  await page.getByRole('button', { name: '編輯', exact: true }).click();
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();
}

async function moveWithMenu(
  page: import('@playwright/test').Page,
  sourceCardId: HomeCardId,
  targetCardId: HomeCardId,
  side: 'left' | 'right' | 'top' | 'bottom',
): Promise<void> {
  const source = page.locator(`[data-home-card-id="${sourceCardId}"]`);
  await source.getByRole('button', { name: '移到…' }).click();
  const popover = page.locator('[class*="moveMenuPopover"]');
  await popover.getByRole('combobox', { name: '目標卡' }).selectOption(targetCardId);
  const label = { left: '左側', right: '右側', top: '上方', bottom: '下方' }[side];
  const direction = popover.getByRole('button', { name: label, exact: true });
  await expect(direction).toBeEnabled();
  await direction.click();
  await expect(source.getByRole('button', { name: /^拖動 / })).toBeFocused();
}

async function signInWithToken(
  page: import('@playwright/test').Page,
  user: TestUser,
  origin = '/',
): Promise<void> {
  await page.addInitScript(
    ([key, token]) => window.localStorage.setItem(key!, token!),
    ['ledger.accessToken', user.token],
  );
  await page.goto(origin);
  await expect(page.getByRole('heading', { level: 2, name: '總覽' })).toBeVisible();
}

function layoutPut(layout: HomeLayoutV1 | null, expectedRevision = 0) {
  return { schemaVersion: 1 as const, expectedRevision, layout };
}

async function prepareWideCategoriesLayout(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  user: TestUser,
): Promise<void> {
  const layout = wideCategoriesDefaultLayout();
  await putHomeLayout(request, user.token, layoutPut(layout));
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
}

async function adjustFirstSeparator(
  page: import('@playwright/test').Page,
  key?: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
): Promise<number> {
  const separator = page.getByRole('separator', { name: '財務趨勢與本月支出分隔線' });
  await separator.focus();
  const before = Number(await separator.getAttribute('aria-valuenow'));
  const orientation = await separator.getAttribute('aria-orientation');
  const resizeKey = key ?? (orientation === 'horizontal' ? 'ArrowDown' : 'ArrowLeft');
  await separator.press(resizeKey);
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .not.toBe(before);
  return Number(await separator.getAttribute('aria-valuenow'));
}

async function firstSeparatorValue(page: import('@playwright/test').Page): Promise<number> {
  return Number(
    await page
      .getByRole('separator', { name: '財務趨勢與本月支出分隔線' })
      .getAttribute('aria-valuenow'),
  );
}

function shape(layout: HomeLayoutV1): string[] {
  return layout.bands.map(({ root }) => nodeShape(root));
}

async function getHomeCardDimensions(
  page: Page,
): Promise<Record<HomeCardId, { width: number; height: number }>> {
  const entries = await page
    .locator(
      '[data-home-layout="tree"] [data-home-card-id], [data-home-layout="editing"] [data-home-card-id]',
    )
    .evaluateAll((cards) =>
      cards.map((card) => {
        const rectangle = card.getBoundingClientRect();
        return [
          card.getAttribute('data-home-card-id') ?? '',
          { width: rectangle.width, height: rectangle.height },
        ] as const;
      }),
    );
  expect(entries).toHaveLength(8);
  return Object.fromEntries(entries) as Record<HomeCardId, { width: number; height: number }>;
}

interface FocusTarget {
  role: 'button' | 'combobox' | 'separator';
  name?: string;
  nameIncludes?: string;
  cardId?: HomeCardId;
}

async function tabTo(page: import('@playwright/test').Page, target: FocusTarget): Promise<void> {
  for (let count = 0; count < 160; count += 1) {
    const matches = await page.evaluate((expected) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tagRole =
        active.getAttribute('role') ??
        (active.tagName === 'BUTTON' ? 'button' : active.tagName === 'SELECT' ? 'combobox' : null);
      const name = active.getAttribute('aria-label') ?? active.innerText?.trim() ?? '';
      const cardId =
        active.closest<HTMLElement>('[data-home-card-menu-for]')?.dataset.homeCardMenuFor ??
        active.closest<HTMLElement>('[data-home-card-id]')?.dataset.homeCardId;
      return (
        tagRole === expected.role &&
        (!expected.name || name === expected.name) &&
        (!expected.nameIncludes || name.includes(expected.nameIncludes)) &&
        (!expected.cardId || cardId === expected.cardId)
      );
    }, target);
    if (matches) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab 鍵未能移到 ${target.name ?? target.nameIncludes ?? target.role}。`);
}

async function tabToMoveMenu(
  page: import('@playwright/test').Page,
  cardId: HomeCardId,
): Promise<void> {
  await tabTo(page, { role: 'button', name: '移到…', cardId });
}

async function moveWithKeyboard(
  page: import('@playwright/test').Page,
  targetCardId: HomeCardId,
  side: 'left' | 'right' | 'top' | 'bottom',
): Promise<void> {
  const sourceCardId: HomeCardId = 'accounts';
  await tabToMoveMenu(page, sourceCardId);
  await page.keyboard.press('Enter');
  await tabTo(page, { role: 'combobox', name: '目標卡', cardId: sourceCardId });
  const menu = page.locator(`[data-home-card-menu-for="${sourceCardId}"]`);
  const targetSelect = menu.getByRole('combobox', { name: '目標卡' });
  for (let count = 0; count < 10; count += 1) {
    if ((await targetSelect.inputValue()) === targetCardId) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(targetSelect).toHaveValue(targetCardId);
  const sideName = { left: '左側', right: '右側', top: '上方', bottom: '下方' }[side];
  await tabTo(page, { role: 'button', name: sideName, cardId: sourceCardId });
  await page.keyboard.press('Enter');
  await expect(
    page.locator(`[data-home-card-id="${sourceCardId}"] [data-home-drag-handle]`),
  ).toBeFocused();
  await expect(
    page.getByText(`帳戶 已移到 ${HOME_CARD_TITLES[targetCardId]} ${sideName}`, { exact: true }),
  ).toBeVisible();
}

test('SC-Y14：完成只存一次，重整與第二個 context 讀到同一版面，無改動不存', async ({
  signedInPage: page,
  openAs,
  userA,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(network.puts[0]?.expectedRevision).toBe(0);
  expect(network.puts[0]?.layout).not.toBeNull();
  expect(parseHomeLayoutV1(network.puts[0]?.layout).ok).toBe(true);

  const saved = network.puts[0]?.layout as HomeLayoutV1;
  expect(saved.bands[1]?.root.type).toBe('split');
  if (saved.bands[1]?.root.type !== 'split') throw new Error('預期第二列為左右分割。');
  expect(saved.bands[1].root.weights[0]).toBeLessThan(6667);
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
  await expect
    .poll(async () => {
      const trend = await page.locator('[data-home-card-id="trend"]').boundingBox();
      const categories = await page.locator('[data-home-card-id="categories"]').boundingBox();
      return (trend?.width ?? 0) - (categories?.width ?? 0);
    })
    .toBeGreaterThan(0);
  const secondContextPage = await openAs(userA);
  await expectCardOrder(secondContextPage, ALL_CARD_IDS);
  await expect
    .poll(async () => {
      const trend = await secondContextPage.locator('[data-home-card-id="trend"]').boundingBox();
      const categories = await secondContextPage
        .locator('[data-home-card-id="categories"]')
        .boundingBox();
      return (trend?.width ?? 0) - (categories?.width ?? 0);
    })
    .toBeGreaterThan(0);

  await enterEditor(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
});

const dragDirections = [
  {
    side: 'left',
    expected: 'x[expense,income,net]|y[trend,x[accounts,categories]]|x[activity,debts]',
  },
  {
    side: 'right',
    expected: 'x[expense,income,net]|y[trend,x[categories,accounts]]|x[activity,debts]',
  },
  {
    side: 'top',
    expected: 'x[expense,income,net]|y[trend,accounts,categories]|x[activity,debts]',
  },
  {
    side: 'bottom',
    expected: 'x[expense,income,net]|y[trend,categories,accounts]|x[activity,debts]',
  },
] as const;

for (const { side, expected } of dragDirections) {
  test(`SC-Y15：把帳戶拖到分類卡的${side}側並收合空位`, async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    await page.setViewportSize({ width: 2800, height: 1600 });
    await prepareWideCategoriesLayout(page, request, userA);
    const network = await watchHomeLayoutRequests(page);
    await enterEditor(page);
    const accounts = page.locator('[data-home-card-id="accounts"]');
    const originalAccountsBox = await accounts.boundingBox();
    expect(originalAccountsBox).not.toBeNull();
    await movePointerToCardSide(page, 'accounts', 'categories', side);
    await expect(
      page.locator(`[data-home-card-id="categories"] > [aria-hidden="true"]`),
    ).toHaveCount(1);
    await page.mouse.up();
    await expect
      .poll(
        async () => {
          const movedAccountsBox = await accounts.boundingBox();
          return (
            movedAccountsBox !== null &&
            (Math.abs(movedAccountsBox.x - originalAccountsBox!.x) > 8 ||
              Math.abs(movedAccountsBox.y - originalAccountsBox!.y) > 8)
          );
        },
        { timeout: 5000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();

    expect(network.puts).toHaveLength(1);
    const saved = network.puts[0]?.layout;
    expect(saved).not.toBeNull();
    expect(parseHomeLayoutV1(saved).ok).toBe(true);
    expect(shape(saved as HomeLayoutV1)).toEqual(expected.split('|'));
  });
}

test('SC-Y16：分隔線一增一減並停在最小值，各列高度獨立調整', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 1600, height: 1800 });
  await enterEditor(page);

  const firstSeparator = page.getByRole('separator', { name: '財務趨勢與本月支出分隔線' });
  await firstSeparator.focus();
  const initialValue = Number(await firstSeparator.getAttribute('aria-valuenow'));
  const initialTrend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  const initialCategories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(initialTrend).not.toBeNull();
  expect(initialCategories).not.toBeNull();

  await firstSeparator.press('ArrowLeft');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBeLessThan(initialValue);
  const reducedTrend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  const expandedCategories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(reducedTrend!.width).toBeLessThan(initialTrend!.width);
  expect(expandedCategories!.width).toBeGreaterThan(initialCategories!.width);

  await firstSeparator.press('ArrowRight');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBe(initialValue);
  const minimum = Number(await firstSeparator.getAttribute('aria-valuemin'));
  await firstSeparator.press('Home');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBeCloseTo(minimum, 2);
  await firstSeparator.press('ArrowLeft');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBeCloseTo(minimum, 2);

  const firstBandHandle = page.getByRole('separator', { name: '第 1 列高度' });
  const firstBandBefore = await page.locator('[data-home-card-id="expense"]').boundingBox();
  const secondBandBefore = await page.locator('[data-home-card-id="trend"]').boundingBox();
  const secondBandCardBefore = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(firstBandBefore).not.toBeNull();
  expect(secondBandBefore).not.toBeNull();
  expect(secondBandCardBefore).not.toBeNull();
  await firstBandHandle.scrollIntoViewIfNeeded();
  const firstHandleBox = await firstBandHandle.boundingBox();
  if (!firstHandleBox) throw new Error('找不到第一列高度把手。');
  await page.mouse.move(firstHandleBox.x + firstHandleBox.width / 2, firstHandleBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(firstHandleBox.x + firstHandleBox.width / 2, firstHandleBox.y + 128, {
    steps: 12,
  });
  await page.mouse.up();

  await expect
    .poll(
      async () => (await page.locator('[data-home-card-id="expense"]').boundingBox())?.height ?? 0,
    )
    .toBeGreaterThan(firstBandBefore!.height + 80);
  const secondBandAfter = await page.locator('[data-home-card-id="trend"]').boundingBox();
  const secondBandCardAfter = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(secondBandAfter!.y).toBeGreaterThan(secondBandBefore!.y + 80);
  expect(secondBandAfter!.height).toBeCloseTo(secondBandBefore!.height, 0);
  expect(secondBandCardAfter!.height).toBeCloseTo(secondBandCardBefore!.height, 0);

  const lastBandHandle = page.getByRole('separator', { name: '第 3 列高度' });
  const lastRowBefore = await page.locator('[data-home-card-id="accounts"]').boundingBox();
  expect(lastRowBefore).not.toBeNull();
  await lastBandHandle.scrollIntoViewIfNeeded();
  const lastHandleBox = await lastBandHandle.boundingBox();
  if (!lastHandleBox) throw new Error('找不到最後一列高度把手。');
  await page.mouse.move(lastHandleBox.x + lastHandleBox.width / 2, lastHandleBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(lastHandleBox.x + lastHandleBox.width / 2, lastHandleBox.y + 88, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await page.locator('[data-home-card-id="accounts"]').boundingBox())?.height ?? 0,
    )
    .toBeGreaterThan(lastRowBefore!.height + 40);
});

test('SC-Y16：上下分隔線以滑鼠和方向鍵一增一減且總高不變', async ({
  signedInPage: page,
  request,
  userA,
}) => {
  await page.setViewportSize({ width: 2800, height: 1800 });
  await prepareWideCategoriesLayout(page, request, userA);
  await expect(page.getByText('還沒有任何交易，從右邊記下第一筆吧。')).toBeVisible();
  const readingDimensions = await getHomeCardDimensions(page);
  await enterEditor(page);
  const editingDimensions = await getHomeCardDimensions(page);
  for (const cardId of ALL_CARD_IDS) {
    expect(
      Math.abs(editingDimensions[cardId].width - readingDimensions[cardId].width),
      `${cardId}: reading width ${readingDimensions[cardId].width}px, editing width ${editingDimensions[cardId].width}px`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(editingDimensions[cardId].height - readingDimensions[cardId].height),
      `${cardId}: reading height ${readingDimensions[cardId].height}px, editing height ${editingDimensions[cardId].height}px`,
    ).toBeLessThanOrEqual(1);
  }

  const separator = page.getByRole('separator', { name: '財務趨勢與本月支出分隔線' });
  const initialValue = Number(await separator.getAttribute('aria-valuenow'));
  const initialTrendHeight = editingDimensions.trend.height;
  const initialCategoriesHeight = editingDimensions.categories.height;
  const initialPairHeight = initialTrendHeight + initialCategoriesHeight;

  await separator.focus();
  await separator.press('ArrowDown');
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBeGreaterThan(initialValue);
  let trend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  let categories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(trend!.height).toBeGreaterThan(initialTrendHeight);
  expect(categories!.height).toBeLessThan(initialCategoriesHeight);
  expect(trend!.height + categories!.height).toBeCloseTo(initialPairHeight, 0);

  await separator.press('ArrowUp');
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBe(initialValue);
  trend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  categories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(trend!.height + categories!.height).toBeCloseTo(initialPairHeight, 0);

  const handleBox = await separator.boundingBox();
  if (!handleBox) throw new Error('找不到上下分隔線。');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2 + 32,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBeGreaterThan(initialValue);
  trend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  categories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(trend!.height + categories!.height).toBeCloseTo(initialPairHeight, 0);

  const resizedBox = await separator.boundingBox();
  if (!resizedBox) throw new Error('找不到調整後的上下分隔線。');
  await page.mouse.move(resizedBox.x + resizedBox.width / 2, resizedBox.y + resizedBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizedBox.x + resizedBox.width / 2,
    resizedBox.y + resizedBox.height / 2 - 32,
    { steps: 12 },
  );
  await page.mouse.up();
  // 滑鼠位置經瀏覽器取整；百分比容許 0.005% 內的次像素誤差，下方仍驗證卡片總高。
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBeCloseTo(initialValue, 2);
  trend = await page.locator('[data-home-card-id="trend"]').boundingBox();
  categories = await page.locator('[data-home-card-id="categories"]').boundingBox();
  expect(trend!.height + categories!.height).toBeCloseTo(initialPairHeight, 0);
});

test('SC-Y16：無多餘高度時上下分隔線仍可聚焦且值域收合', async ({
  signedInPage: page,
  request,
  userA,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const defaultLayout = wideCategoriesDefaultLayout();
  const minimumHeightLayout: HomeLayoutV1 = {
    bands: defaultLayout.bands.map((band, index) =>
      index === 1 ? { ...band, extraHeightPx: 0 } : band,
    ),
  };
  await putHomeLayout(request, userA.token, layoutPut(minimumHeightLayout));
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
  await enterEditor(page);

  const separator = page.getByRole('separator', { name: '財務趨勢與本月支出分隔線' });
  await expect(separator).toBeEnabled();
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuemin')))
    .toBeGreaterThan(0);
  const minimum = Number(await separator.getAttribute('aria-valuemin'));
  expect(Number(await separator.getAttribute('aria-valuemax'))).toBe(minimum);
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(minimum);

  await separator.focus();
  await expect(separator).toBeFocused();
  await separator.press('ArrowDown');
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(minimum);
});

test('SC-Y17：取消丟掉草稿並回到編輯前的版面', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  const savedWeight = await firstSeparatorValue(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  await expectCardOrder(page, ALL_CARD_IDS);
  await enterEditor(page);
  await expect.poll(() => firstSeparatorValue(page)).toBe(savedWeight);
  expect(network.puts).toHaveLength(0);
});

test('SC-Y17：重設後完成送出 layout null', async ({ signedInPage: page, request, userA }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  await putHomeLayout(request, userA.token, layoutPut(DEFAULT_HOME_LAYOUT_V1));
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  const defaultWeight = await firstSeparatorValue(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '重設為預設' }).click();
  await expectCardOrder(page, ALL_CARD_IDS);
  await expect.poll(() => firstSeparatorValue(page)).toBe(defaultWeight);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(network.puts[0]?.layout).toBeNull();
});

test('SC-Y17：重設後取消不送出請求', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '重設為預設' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(0);
});

test('SC-Y17：重設權重草稿後分隔線回到預設比例', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  await enterEditor(page);
  const defaultWeight = await firstSeparatorValue(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '重設為預設' }).click();
  await expect.poll(() => firstSeparatorValue(page)).toBe(defaultWeight);
});

test('SC-Y18：同一 context 的 B 收到 409 後載入 A 的最新版，仍留在編輯模式', async ({
  signedInPage: pageA,
  userA,
}) => {
  await pageA.setViewportSize({ width: 2800, height: 1600 });
  const pageB = await pageA.context().newPage();
  await signInWithToken(pageB, userA);
  await pageB.setViewportSize({ width: 2800, height: 1600 });
  const networkA = await watchHomeLayoutRequests(pageA);
  const networkB = await watchHomeLayoutRequests(pageB);

  await enterEditor(pageB);
  await adjustFirstSeparator(pageB, 'Home');
  await enterEditor(pageA);
  const latestWeight = await adjustFirstSeparator(pageA);
  await pageA.getByRole('button', { name: '完成', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  await pageB.getByRole('button', { name: '完成', exact: true }).click();

  const conflict = pageB.getByRole('dialog', { name: '版面已在其他地方更新' });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: '載入最新' }).click();
  await expect(pageB.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await expectCardOrder(pageB, ALL_CARD_IDS);
  await expect.poll(() => firstSeparatorValue(pageB)).toBe(latestWeight);
  await expect(conflict).toHaveCount(0);
  expect(networkA.puts).toHaveLength(1);
  expect(networkB.puts).toHaveLength(1);
  expect(networkB.gets).toBeGreaterThanOrEqual(1);
});

test('SC-Y18：用我的覆蓋以 B 的版面更新伺服器', async ({ signedInPage: pageA, userA, request }) => {
  await pageA.setViewportSize({ width: 2800, height: 1600 });
  const pageB = await pageA.context().newPage();
  await signInWithToken(pageB, userA);
  await pageB.setViewportSize({ width: 2800, height: 1600 });
  const networkA = await watchHomeLayoutRequests(pageA);
  const networkB = await watchHomeLayoutRequests(pageB);

  await enterEditor(pageB);
  const bWeight = await adjustFirstSeparator(pageB, 'Home');
  await enterEditor(pageA);
  await adjustFirstSeparator(pageA);
  await pageA.getByRole('button', { name: '完成', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  await pageB.getByRole('button', { name: '完成', exact: true }).click();
  const conflict = pageB.getByRole('dialog', { name: '版面已在其他地方更新' });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: '用我的覆蓋' }).click();
  await expect(pageB.getByRole('button', { name: '編輯', exact: true })).toBeVisible();

  expect(networkA.puts).toHaveLength(1);
  expect(networkB.puts).toHaveLength(2);
  expect(networkB.puts.map(({ expectedRevision }) => expectedRevision)).toEqual([0, 1]);
  const saved = await getHomeLayout(request, userA.token);
  expect(saved.layout).not.toBeNull();
  const savedLayout = saved.layout as HomeLayoutV1;
  expect(parseHomeLayoutV1(savedLayout).ok).toBe(true);
  const middleRoot = savedLayout.bands[1]?.root;
  expect(middleRoot?.type).toBe('split');
  if (middleRoot?.type !== 'split') throw new Error('預期第二列為左右分割。');
  expect(middleRoot.weights[0]! / 100).toBe(bWeight);
});

test('SC-Y18：覆蓋期間 A 再存一次，B 第二次 409 保留草稿與彈窗', async ({
  signedInPage: pageA,
  userA,
}) => {
  await pageA.setViewportSize({ width: 2800, height: 1600 });
  const pageB = await pageA.context().newPage();
  await signInWithToken(pageB, userA);
  await pageB.setViewportSize({ width: 2800, height: 1600 });
  let allowOverwrite!: () => void;
  const overwriteGate = new Promise<void>((resolve) => {
    allowOverwrite = resolve;
  });
  let overwriteStarted = false;
  const networkA = await watchHomeLayoutRequests(pageA);
  const networkB = await watchHomeLayoutRequests(pageB, {
    put: async (route, _body, log) => {
      if (log.puts.length === 2) {
        overwriteStarted = true;
        await overwriteGate;
      }
      await route.continue();
    },
  });

  await enterEditor(pageB);
  const bWeight = await adjustFirstSeparator(pageB, 'Home');
  await enterEditor(pageA);
  await adjustFirstSeparator(pageA);
  await pageA.getByRole('button', { name: '完成', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  await pageB.getByRole('button', { name: '完成', exact: true }).click();
  const conflict = pageB.getByRole('dialog', { name: '版面已在其他地方更新' });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: '用我的覆蓋' }).click();
  await expect.poll(() => overwriteStarted, { timeout: 10_000 }).toBe(true);
  expect(networkB.puts[1]?.expectedRevision).toBe(1);

  await enterEditor(pageA);
  await adjustFirstSeparator(pageA);
  await pageA.getByRole('button', { name: '完成', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  allowOverwrite();

  await expect(conflict).toBeVisible();
  await expect(pageB.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await expectCardOrder(pageB, ALL_CARD_IDS);
  await expect.poll(() => firstSeparatorValue(pageB)).toBe(bWeight);
  expect(networkA.puts).toHaveLength(2);
  expect(networkB.puts).toHaveLength(2);
});

test('SC-Y19：PUT 網路失敗後顯示錯誤並保留草稿', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page, {
    put: async (route) => route.abort(),
  });
  await enterEditor(page);
  const draftedWeight = await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);
  expect(network.puts).toHaveLength(1);
  expect(network.gets).toBeGreaterThanOrEqual(1);
});

test('SC-Y19：逾時但未存入時保留草稿，重試仍帶原 revision', async ({ signedInPage: page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page, {
    put: async (route, _body, log) => {
      if (log.puts.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        try {
          await route.abort();
        } catch {
          // 前端逾時會先中止瀏覽器請求，這裡只負責讓仍暫停的 route 收尾。
        }
      } else {
        await route.continue();
      }
    },
  });
  await enterEditor(page);
  const draftedWeight = await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => network.gets, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(2);
  expect(network.puts.map(({ expectedRevision }) => expectedRevision)).toEqual([0, 0]);
});

test('SC-Y19：補查 GET 失敗時保留草稿，重試仍帶原 revision', async ({ signedInPage: page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 2800, height: 1600 });
  const network = await watchHomeLayoutRequests(page, {
    get: async (route, log) => {
      if (log.puts.length > 0 && log.gets === 1) await route.abort();
      else await route.continue();
    },
    put: async (route, _body, log) => {
      if (log.puts.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        try {
          await route.abort();
        } catch {
          // 前端逾時會先中止瀏覽器請求，這裡只負責讓仍暫停的 route 收尾。
        }
      } else {
        await route.continue();
      }
    },
  });
  await enterEditor(page);
  const draftedWeight = await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => network.gets, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(2);
  expect(network.puts.map(({ expectedRevision }) => expectedRevision)).toEqual([0, 0]);
});

test('SC-Y19：PUT 已存但回應逾時時以真實 GET 確認，不重送', async ({ signedInPage: page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 2800, height: 1600 });
  let backendSaved = false;
  let delayedRouteFinished = false;
  let recheckedRevision = 0;
  let recheckedLayout: HomeLayoutV1 | null | undefined;
  let savedLayout: HomeLayoutV1 | null | undefined;
  const network = await watchHomeLayoutRequests(page, {
    get: async (route) => {
      const response = await route.fetch();
      const latest = (await response.json()) as HomeLayoutResponse;
      recheckedRevision = latest.revision;
      recheckedLayout = latest.layout;
      await route.fulfill({ response, body: JSON.stringify(latest) });
    },
    put: async (route, body) => {
      savedLayout = body.layout;
      const response = await route.fetch();
      backendSaved = response.ok();
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      try {
        await route.fulfill({ response });
      } catch {
        // 瀏覽器已按產品的 10 秒逾時中止原請求；GET 會讀到 route.fetch 已寫入的版面。
      }
      delayedRouteFinished = true;
    },
  });
  await enterEditor(page);
  const draftedWeight = await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect.poll(() => backendSaved, { timeout: 5_000 }).toBe(true);
  await expect.poll(() => network.gets, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => recheckedRevision, { timeout: 5_000 }).toBe(1);
  await expect.poll(() => delayedRouteFinished, { timeout: 5_000 }).toBe(true);
  expect(network.puts).toHaveLength(1);
  expect(recheckedLayout).toEqual(savedLayout);
  expect(savedLayout).not.toBeNull();
  expect(parseHomeLayoutV1(savedLayout).ok).toBe(true);
  const savedRoot = savedLayout?.bands[1]?.root;
  expect(savedRoot?.type).toBe('split');
  if (savedRoot?.type !== 'split') throw new Error('預期儲存的第二列是分割版面。');
  expect(savedRoot.weights[0]! / 100).toBeCloseTo(draftedWeight, 1);
});

test('SC-Y19：儲存中停用編輯操作', async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  let allowSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    allowSave = resolve;
  });
  let saveStarted = false;
  const network = await watchHomeLayoutRequests(page, {
    put: async (route) => {
      saveStarted = true;
      await saveGate;
      await route.continue();
    },
  });
  await enterEditor(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect.poll(() => saveStarted, { timeout: 5_000 }).toBe(true);

  await expect(page.getByRole('button', { name: '儲存中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^拖動 / }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: '移到…' }).first()).toBeDisabled();
  await expect(page.getByRole('separator', { name: /分隔線/ }).first()).toBeDisabled();
  await expect(page.getByRole('separator', { name: '第 1 列高度' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重設為預設' })).toBeDisabled();
  allowSave();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
});

test('SC-Y19：儲存時登出並登入另一帳號，晚到回應不帶入前一人的草稿', async ({
  signedInPage: page,
  userA,
  userB,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let serverReceivedPut = false;
  const network = await watchHomeLayoutRequests(page, {
    put: async (route) => {
      const response = await route.fetch();
      serverReceivedPut = response.ok();
      await responseGate;
      try {
        await route.fulfill({ response });
      } catch {
        // 登出會取消舊世代的瀏覽器請求；仍讓測試確認新帳號畫面沒有沿用舊草稿。
      }
    },
  });
  await enterEditor(page);
  await adjustFirstSeparator(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect.poll(() => serverReceivedPut, { timeout: 5_000 }).toBe(true);
  await openUserMenu(page);
  await page.getByRole('button', { name: '登出' }).click();
  await page.getByRole('button', { name: '登入', exact: true }).click();
  const login = page.getByRole('dialog', { name: '登入' });
  await login.getByLabel('Email').fill(userB.email);
  await login.getByLabel('密碼').fill(TEST_PASSWORD);
  await login.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '總覽' })).toBeVisible();
  releaseResponse();
  await expectCardOrder(page, ALL_CARD_IDS);
  await enterEditor(page);
  await expectCardOrder(page, ALL_CARD_IDS);
  expect(network.puts).toHaveLength(1);
  expect(userA.id).not.toBe(userB.id);
});

test('SC-Y20：全程鍵盤完成四方向移動、分隔線與列高調整及儲存', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const wideLayout = wideCategoriesDefaultLayout();
  const keyboardMoveLayout: HomeLayoutV1 = {
    bands: wideLayout.bands.map((band, index) =>
      index === 2 ? { ...band, extraHeightPx: 400 } : band,
    ),
  };
  await putHomeLayout(request, userA.token, layoutPut(keyboardMoveLayout));
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
  const network = await watchHomeLayoutRequests(page);
  await tabTo(page, { role: 'button', name: '編輯' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();

  await moveWithKeyboard(page, 'categories', 'left');
  await moveWithKeyboard(page, 'trend', 'right');
  await moveWithKeyboard(page, 'categories', 'top');
  await moveWithKeyboard(page, 'activity', 'bottom');

  await tabTo(page, { role: 'separator', nameIncludes: '最近｜標註與帳戶分隔線' });
  const separator = page.locator(':focus');
  const initialSeparatorValue = Number(await separator.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBeGreaterThan(initialSeparatorValue);

  await tabTo(page, { role: 'separator', name: '第 3 列高度' });
  const bandHandle = page.locator(':focus');
  const initialBandHeight = Number(await bandHandle.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => Number(await bandHandle.getAttribute('aria-valuenow')))
    .toBe(initialBandHeight + 16);

  await tabTo(page, { role: 'button', name: '完成' });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(parseHomeLayoutV1(network.puts[0]?.layout).ok).toBe(true);
});

test('SC-Y21：Esc 與 pointercancel 放棄拖動；自動捲動時顯示受限寬度縮圖', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await page.setViewportSize({ width: 2800, height: 1600 });
  const wideLayout = wideCategoriesDefaultLayout();
  const tallDragLayout: HomeLayoutV1 = {
    bands: wideLayout.bands.map((band) => ({
      ...band,
      extraHeightPx: Math.max(band.extraHeightPx, 400),
    })),
  };
  await putHomeLayout(request, userA.token, layoutPut(tallDragLayout));
  await page.reload();
  await expectCardOrder(page, ALL_CARD_IDS);
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  const editViewport = page.getByTestId('home-layout-edit-viewport');
  await expect
    .poll(() => editViewport.evaluate((element) => element.scrollHeight <= element.clientHeight))
    .toBe(true);

  await movePointerToCardSide(page, 'accounts', 'categories', 'bottom');
  await expect(
    page.locator('[aria-hidden="true"]').filter({ hasText: '帳戶' }).last(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectCardOrder(page, ALL_CARD_IDS);

  await page.evaluate(() => {
    window.addEventListener(
      'pointerdown',
      (event) => {
        (window as Window & { __homeLayoutPointerId?: number }).__homeLayoutPointerId =
          event.pointerId;
      },
      { capture: true },
    );
  });
  await movePointerToCardSide(page, 'accounts', 'categories', 'bottom');
  const pointerId = await page.evaluate(
    () => (window as Window & { __homeLayoutPointerId?: number }).__homeLayoutPointerId ?? 1,
  );
  await page.dispatchEvent(
    '[data-home-card-id="accounts"] [data-home-drag-handle]',
    'pointercancel',
    { bubbles: true, pointerId, pointerType: 'mouse' },
  );
  await page.mouse.up();
  await expectCardOrder(page, ALL_CARD_IDS);

  await page.setViewportSize({ width: 2800, height: 640 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const source = page.locator('[data-home-card-id="expense"]');
  const handle = source.getByRole('button', { name: /^拖動 / });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('找不到本月支出拖動把手。');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 8, handleBox.y + 12, { steps: 2 });
  const preview = page.locator('[aria-hidden="true"]').filter({ hasText: '本月支出' }).last();
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.width).toBeLessThanOrEqual(320);
  await page.mouse.move(640, 630, { steps: 12 });
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectCardOrder(page, ALL_CARD_IDS);
  expect(network.puts).toHaveLength(0);
});

test('SC-Y26：預設會換行時畫布橫向捲動，仍可移動、調整、重設與存檔', async ({
  signedInPage: page,
  request,
  userA,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await putHomeLayout(request, userA.token, layoutPut(DEFAULT_HOME_LAYOUT_V1));
  await page.reload();
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);

  const viewport = page.getByTestId('home-layout-edit-viewport');
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const secondBandHandle = page.getByRole('separator', { name: '第 2 列高度' });
  await secondBandHandle.focus();
  await secondBandHandle.press('End');
  const firstSeparator = page.getByRole('separator', { name: '財務趨勢與本月支出分隔線' });
  await firstSeparator.focus();
  const initialSplit = Number(await firstSeparator.getAttribute('aria-valuenow'));
  await firstSeparator.press('ArrowLeft');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBeLessThan(initialSplit);
  await moveWithMenu(page, 'accounts', 'categories', 'bottom');
  await page.getByRole('button', { name: '重設為預設' }).click();
  await expectCardOrder(page, ALL_CARD_IDS);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(network.puts[0]?.layout).toBeNull();

  await enterEditor(page);
  await page.getByRole('separator', { name: '第 2 列高度' }).press('End');
  await moveWithMenu(page, 'accounts', 'categories', 'bottom');
  const draftOrder: readonly HomeCardId[] = [
    'expense',
    'income',
    'net',
    'trend',
    'categories',
    'accounts',
    'activity',
    'debts',
  ];
  await page.getByRole('button', { name: '新增交易' }).click();
  await expect(newTransactionForm(page)).toBeVisible();
  await expectCardOrder(page, draftOrder);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
});

test('SC-Y26、SC-Y28：八卡單列舊版面仍能移動和調整，再重設存檔', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await page.setViewportSize({ width: 3000, height: 1500 });
  const oneRow = eightCardsInOneRow();
  const tallOneRow: HomeLayoutV1 = {
    bands: [{ ...oneRow.bands[0]!, extraHeightPx: 400 }],
  };
  await putHomeLayout(request, userA.token, layoutPut(tallOneRow));
  await page.reload();
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  await expectCardOrder(page, ALL_CARD_IDS);

  await moveWithMenu(page, 'accounts', 'debts', 'bottom');
  const movedOrder: readonly HomeCardId[] = [
    'expense',
    'income',
    'net',
    'trend',
    'categories',
    'activity',
    'debts',
    'accounts',
  ];
  await expectCardOrder(page, movedOrder);
  const firstSeparator = page.getByRole('separator', { name: '借還與帳戶分隔線' });
  await firstSeparator.focus();
  const before = Number(await firstSeparator.getAttribute('aria-valuenow'));
  await firstSeparator.press('ArrowDown');
  await expect
    .poll(async () => Number(await firstSeparator.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before);
  await page.getByRole('button', { name: '重設為預設' }).click();
  await expectCardOrder(page, ALL_CARD_IDS);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(network.puts[0]?.layout).toBeNull();
});

test('SC-Y27：離開首頁、切帳本與窄螢幕時保留草稿，另一帳號看不到草稿', async ({
  signedInPage: page,
  userA,
  userB,
  request,
}) => {
  await createLedger(request, userA.token, { name: '草稿測試帳本', kind: 'SHARED' });
  await page.reload();
  await page.setViewportSize({ width: 2800, height: 1500 });
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  const draftedWeight = await adjustFirstSeparator(page);

  await page.getByRole('link', { name: '統計', exact: true }).click();
  await page.getByRole('link', { name: '首頁', exact: true }).click();
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);
  await switchLedger(page, '草稿測試帳本');
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);

  await page.setViewportSize({ width: 900, height: 1200 });
  await expect(page.locator('[data-home-layout="narrow"]')).toBeVisible();
  await expect(page.locator('[data-home-drag-handle]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重設為預設' })).toHaveCount(0);
  await expect(page.getByRole('separator', { name: /分隔線|列高度/ })).toHaveCount(0);
  await expectCardOrder(page, ALL_CARD_IDS);

  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();
  await expect.poll(() => firstSeparatorValue(page)).toBe(draftedWeight);

  await openUserMenu(page);
  await page.getByRole('button', { name: '登出' }).click();
  await page.getByRole('button', { name: '登入', exact: true }).click();
  const login = page.getByRole('dialog', { name: '登入' });
  await login.getByLabel('Email').fill(userB.email);
  await login.getByLabel('密碼').fill(TEST_PASSWORD);
  await login.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '總覽' })).toBeVisible();
  await expectCardOrder(page, ALL_CARD_IDS);
  await enterEditor(page);
  await expectCardOrder(page, ALL_CARD_IDS);
  expect(await firstSeparatorValue(page)).not.toBe(draftedWeight);
  expect(network.puts).toHaveLength(0);
});

test('SC-Y27：離開首頁期間外部存檔，回來完成時顯示 409', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await page.setViewportSize({ width: 2800, height: 1500 });
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  await adjustFirstSeparator(page);
  await page.getByRole('link', { name: '統計', exact: true }).click();
  const current = await getHomeLayout(request, userA.token);
  await putHomeLayout(request, userA.token, layoutPut(eightCardsInOneRow(), current.revision));
  await page.getByRole('link', { name: '首頁', exact: true }).click();
  await expect(page.getByTestId('home-layout-edit-viewport')).toBeVisible();
  await expectCardOrder(page, ALL_CARD_IDS);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '版面已在其他地方更新' })).toBeVisible();
  expect(network.puts).toHaveLength(1);
  expect(network.puts[0]?.expectedRevision).toBe(current.revision);
  expect(network.gets).toBeGreaterThanOrEqual(1);
});

test('SC-Y28：超出深度上限時拖動沒有落點且移到方向停用', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  await page.setViewportSize({ width: 5000, height: 2200 });
  const deepLayout = layoutAtMaximumDepth();
  expect(parseHomeLayoutV1(deepLayout).ok).toBe(true);
  await putHomeLayout(request, userA.token, layoutPut(deepLayout));
  await page.reload();
  const network = await watchHomeLayoutRequests(page);
  await enterEditor(page);
  const originalShape = await page
    .locator('[data-testid="home-layout-edit-viewport"] [data-home-card-id]')
    .evaluateAll((cards) => cards.map((element) => element.getAttribute('data-home-card-id')));

  await movePointerToCardSide(page, 'expense', 'accounts', 'right');
  await expect(page.locator('[data-home-card-id="accounts"] > [aria-hidden="true"]')).toHaveCount(
    0,
  );
  await page.mouse.up();
  await expectCardOrder(page, originalShape as HomeCardId[]);

  const source = page.locator('[data-home-card-id="expense"]');
  await source.getByRole('button', { name: '移到…' }).click();
  const menu = page.locator('[class*="moveMenuPopover"]');
  await menu.getByRole('combobox', { name: '目標卡' }).selectOption('accounts');
  await expect(menu.getByRole('button', { name: '右側', exact: true })).toBeDisabled();
  expect(network.puts).toHaveLength(0);
});

test('SC-Y31：最上列移動選單浮在下列卡片與結餘卡文字上方', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const roomyTargetLayout: HomeLayoutV1 = {
    bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
      index === 1 && band.root.type === 'split'
        ? { ...band, root: { ...band.root, weights: [8000, 2000] } }
        : band,
    ),
  };
  await putHomeLayout(request, userA.token, layoutPut(roomyTargetLayout));
  await page.reload();
  await page.setViewportSize({ width: 5000, height: 2200 });
  await enterEditor(page);

  const source = page.locator('[data-home-card-id="net"]');
  const sourceTop = await source.evaluate((element) => element.getBoundingClientRect().top);
  const firstRowTop = await page
    .locator('[data-testid="home-layout-edit-viewport"] [data-home-card-id]')
    .evaluateAll((cards) => Math.min(...cards.map((card) => card.getBoundingClientRect().top)));
  expect(Math.abs(sourceTop - firstRowTop)).toBeLessThanOrEqual(1);

  await source.getByRole('button', { name: '移到…' }).click();
  const popover = page.locator('[class*="moveMenuPopover"]');
  await expect(popover).toBeVisible();

  const overlap = await page.evaluate(() => {
    const sourceCard = document.querySelector<HTMLElement>('[data-home-card-id="net"]');
    const popoverElement = document.querySelector<HTMLElement>('[class*="moveMenuPopover"]');
    const sourceBody = sourceCard?.querySelector<HTMLElement>('[data-home-card-body]');
    if (!sourceCard || !popoverElement || !sourceBody) return null;

    const sourceRect = sourceCard.getBoundingClientRect();
    const popoverRect = popoverElement.getBoundingClientRect();
    const bodyRect = sourceBody.getBoundingClientRect();
    const nextCard = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="home-layout-edit-viewport"] [data-home-card-id]',
      ),
    )
      .filter((card) => card !== sourceCard)
      .map((card) => ({ card, rect: card.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.top >= sourceRect.bottom - 1 &&
          rect.top < popoverRect.bottom &&
          rect.bottom > popoverRect.top &&
          rect.left < popoverRect.right &&
          rect.right > popoverRect.left,
      )
      .sort((first, second) => first.rect.top - second.rect.top)[0];
    if (!nextCard) return null;

    function hitPopover(left: number, top: number, right: number, bottom: number): boolean {
      if (right - left < 2 || bottom - top < 2) return false;
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const target = document.elementFromPoint(point.x, point.y);
      return target?.closest('[class*="moveMenuPopover"]') === popoverElement;
    }

    return {
      extendsBelowSource: popoverRect.bottom > sourceRect.bottom,
      overlapsNextCard: popoverRect.bottom > nextCard.rect.top,
      hitsMenuOverNextCard: hitPopover(
        Math.max(popoverRect.left, nextCard.rect.left),
        Math.max(popoverRect.top, nextCard.rect.top),
        Math.min(popoverRect.right, nextCard.rect.right),
        Math.min(popoverRect.bottom, nextCard.rect.bottom),
      ),
      hitsMenuOverSourceBody: hitPopover(
        Math.max(popoverRect.left, bodyRect.left),
        Math.max(popoverRect.top, bodyRect.top),
        Math.min(popoverRect.right, bodyRect.right),
        Math.min(popoverRect.bottom, bodyRect.bottom),
      ),
    };
  });

  expect(overlap).not.toBeNull();
  expect(overlap?.extendsBelowSource).toBe(true);
  expect(overlap?.overlapsNextCard).toBe(true);
  expect(overlap?.hitsMenuOverNextCard).toBe(true);
  expect(overlap?.hitsMenuOverSourceBody).toBe(true);

  await page.getByRole('combobox', { name: '目標卡' }).selectOption('trend');
  const direction = page.getByRole('button', { name: '左側', exact: true });
  await expect(direction).toBeEnabled();
  await direction.click();
  await expect(source.getByRole('button', { name: /^拖動 / })).toBeFocused();

  await page.setViewportSize({ width: 5000, height: 320 });
  const trigger = source.getByRole('button', { name: '移到…' });
  await trigger.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await trigger.click();
  await expect(popover).toBeVisible();
  await expect
    .poll(async () => {
      const box = await popover.boundingBox();
      return box !== null && box.y + box.height <= 320;
    })
    .toBe(true);
  const popoverBox = await popover.boundingBox();
  expect(popoverBox).not.toBeNull();
  expect(popoverBox?.y).toBeGreaterThanOrEqual(0);
  expect((popoverBox?.y ?? 0) + (popoverBox?.height ?? 0)).toBeLessThanOrEqual(320);
});

async function setContentWidth(
  page: import('@playwright/test').Page,
  targetWidth: number,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const measured = await page
      .locator('[data-home-layout="tree"]')
      .evaluate((element) => element.getBoundingClientRect().width);
    if (Math.abs(measured - targetWidth) <= 1) return;
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({
      width: viewportWidth + Math.round(targetWidth - measured),
      height: 1800,
    });
  }
  const measured = await page
    .locator('[data-home-layout="tree"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(measured - targetWidth)).toBeLessThanOrEqual(1);
}

test('SC-Y29：指定巢狀樹在兩個內容寬度都逐層換行且卡片不溢出視窗', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const layout = nestedWrappingLayout();
  expect(parseHomeLayoutV1(layout).ok).toBe(true);
  await putHomeLayout(request, userA.token, layoutPut(layout));
  await page.reload();

  for (const width of [1152, 976]) {
    await setContentWidth(page, width);
    await expect(page.locator('[data-home-layout="tree"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    const cardBoxes = await page
      .locator('[data-home-layout="tree"] [data-home-card-id]')
      .evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right };
        }),
      );
    expect(cardBoxes).toHaveLength(8);
    for (const box of cardBoxes) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual((await page.evaluate(() => window.innerWidth)) + 1);
    }
  }
});
