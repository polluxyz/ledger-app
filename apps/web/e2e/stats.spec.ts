import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  addMember,
  createAccount,
  createCategory,
  createDebtEntry,
  createLedger,
  createTransaction,
  forgiveCounterparty,
  listAccounts,
  listCategories,
  listLedgerPeople,
  updateUserName,
  type TestUser,
} from './api';
import { expect, test } from './fixtures';
import { expectHomeSectionOrder, switchLedger } from './ui';

/**
 * 統計頁的端對端驗收：測試資料只透過正式 API 建立，首頁、統計頁與交易頁都用瀏覽器操作。
 * 日期以台灣時區動態計算；390px 情境逐一檢查各分頁、圖型、長文字與觸控區。
 */

const LONG_CATEGORY_NAME = '超長分類名稱驗證文字'.repeat(4);
const LONG_MEMBER_NAME = '測試共享帳本成員名稱完整顯示確認'.repeat(3);

async function expectCompactMonthLabels(labels: Locator, controls: Locator) {
  const count = await labels.count();
  expect(count).toBe(12);
  await expect(controls).toHaveCount(count);

  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    const accessibleName = await controls.nth(index).getAttribute('aria-label');
    const monthMatch = accessibleName?.match(/^(\d{4})年(\d{1,2})月/);
    expect(monthMatch).not.toBeNull();
    if (!monthMatch) {
      continue;
    }

    const [, year, monthNumber] = monthMatch;
    const month = Number(monthNumber);
    const expected = `${month}月${index === 0 || month === 1 ? year : ''}`;
    expect((await label.innerText()).replace(/\s/g, '')).toBe(expected);
    expect(await label.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
  }
}

async function expectResponsiveLineMonthLabels(
  labels: Locator,
  controls: Locator,
  expectedVisibleCount: number,
): Promise<void> {
  const count = await labels.count();
  expect(count).toBe(12);
  await expect(controls).toHaveCount(count);

  const visibleIndices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (await labels.nth(index).isVisible()) {
      visibleIndices.push(index);
    }
  }
  expect(visibleIndices.length).toBeGreaterThan(0);
  expect(visibleIndices.length).toBe(expectedVisibleCount);

  let previousVisibleYear: string | null = null;
  for (const index of visibleIndices) {
    const accessibleName = await controls.nth(index).getAttribute('aria-label');
    const monthMatch = accessibleName?.match(/^(\d{4})\D+(\d{1,2})\D/);
    expect(monthMatch).not.toBeNull();
    if (!monthMatch) {
      continue;
    }

    const [, year, monthNumber] = monthMatch;
    const showYear = previousVisibleYear === null || previousVisibleYear !== year;
    const expectedDigits = [Number(monthNumber), ...(showYear ? [Number(year)] : [])];
    const label = labels.nth(index);
    const labelDigits = (await label.innerText()).match(/\d+/g) ?? [];
    expect(labelDigits.map(Number)).toEqual(expectedDigits);
    expect(await label.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    expect(await label.evaluate((element) => element.children.length)).toBe(2);
    previousVisibleYear = year!;
  }
}

async function expectResponsiveLineMonthPositions(labels: Locator, points: Locator): Promise<void> {
  const count = await labels.count();
  await expect(points).toHaveCount(count * 2);

  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    if (!(await label.isVisible())) {
      continue;
    }

    const labelRect = await label.evaluate((element) => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
    const pointRect = await points.nth(index * 2).evaluate((element) => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
    const alignedLabelX =
      index === 0
        ? labelRect.left
        : index === count - 1
          ? labelRect.right
          : (labelRect.left + labelRect.right) / 2;
    const incomePointX = (pointRect.left + pointRect.right) / 2;
    expect(Math.abs(alignedLabelX - incomePointX)).toBeLessThanOrEqual(6);
  }
}

async function expectMonthLabelGaps(labels: Locator): Promise<void> {
  const visibleLabels = labels.filter({ visible: true });
  const count = await visibleLabels.count();
  expect(count).toBeGreaterThan(0);
  const gaps = await visibleLabels.evaluateAll((elements) =>
    elements.slice(1).map((element, index) => {
      const current = element.getBoundingClientRect();
      const previous = elements[index]!.getBoundingClientRect();
      return current.left - previous.right;
    }),
  );
  for (const gap of gaps) {
    expect(gap).toBeGreaterThanOrEqual(4);
  }
}

interface TaiwanMonth {
  value: string;
  from: string;
  to: string;
  transactionDate: string;
}

interface HouseholdSeed {
  ledger: { id: string; name: string };
  dinnerCategoryId: string;
}

/**
 * 使用 `Asia/Taipei` 算出目前月份，交易放在本月 1 日正午，避免依執行機器時區跨日。
 */
function currentTaiwanMonth(now = new Date()): TaiwanMonth {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const monthNumber = parts.find((part) => part.type === 'month')?.value;
  if (!year || !monthNumber) {
    throw new Error('無法依台灣時區計算目前月份。');
  }

  const value = `${year}-${monthNumber}`;
  const lastDay = new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate();
  return {
    value,
    from: `${value}-01`,
    to: `${value}-${String(lastDay).padStart(2, '0')}`,
    transactionDate: `${value}-01T12:00:00+08:00`,
  };
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year} 年 ${Number(monthNumber)} 月`;
}

function trendMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

function statsPath(ledgerId: string, month: string): string {
  const params = new URLSearchParams({
    tab: 'cat',
    ledger: ledgerId,
    month,
    perspective: 'LEDGER',
    chart: 'donut',
  });
  return `/stats?${params.toString()}`;
}

async function cashAccountId(request: APIRequestContext, user: TestUser): Promise<string> {
  const account = (await listAccounts(request, user.token)).find((item) => item.name === '現金');
  if (!account) {
    throw new Error('測試帳號註冊後應有「現金」帳戶。');
  }
  return account.id;
}

async function seedHousehold(
  request: APIRequestContext,
  userA: TestUser,
  userB: TestUser,
  month: TaiwanMonth,
): Promise<HouseholdSeed> {
  await updateUserName(request, userA.token, '我');
  await updateUserName(request, userB.token, '小美');

  const ledger = await createLedger(request, userA.token, { name: '家用', kind: 'SHARED' });
  await addMember(request, userA.token, ledger.id, { email: userB.email, role: 'EDITOR' });
  const people = await listLedgerPeople(request, userA.token, ledger.id);
  const me = people.find((person) => person.userId === userA.id);
  const smallMay = people.find((person) => person.userId === userB.id);
  if (!me || !smallMay) {
    throw new Error('家用帳本建立後應列出我與小美兩位成員。');
  }

  const accountId = await cashAccountId(request, userA);
  const dinner = await createCategory(request, userA.token, ledger.id, {
    name: '晚餐',
    type: 'EXPENSE',
  });
  const dailyGoods = await createCategory(request, userA.token, ledger.id, {
    name: '日用品',
    type: 'EXPENSE',
  });
  const refund = await createCategory(request, userA.token, ledger.id, {
    name: '退款',
    type: 'INCOME',
  });

  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 90_000,
    date: month.transactionDate,
    categoryId: dinner.id,
    accountId,
    title: '晚餐',
    ledgerSplit: {
      method: 'AMOUNT',
      shares: [
        { personId: me.id, amount: 45_000 },
        { personId: smallMay.id, amount: 45_000 },
      ],
    },
  });
  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: 30_000,
    date: month.transactionDate,
    categoryId: dailyGoods.id,
    title: '衛生紙',
    payerPersonId: smallMay.id,
  });
  await createTransaction(request, userA.token, ledger.id, {
    type: 'INCOME',
    amount: 20_000,
    date: month.transactionDate,
    categoryId: refund.id,
    accountId,
    title: '退費',
  });

  return { ledger, dinnerCategoryId: dinner.id };
}

/** 用 API 建立固定分類與差額資料，讓私人帳本能核對 §1 第 1、5 步的數字。 */
async function seedDailyLedger(
  request: APIRequestContext,
  user: TestUser,
  month: TaiwanMonth,
): Promise<{ id: string }> {
  const ledger = await createLedger(request, user.token, { name: '日常', kind: 'PERSONAL' });
  const accountId = await cashAccountId(request, user);
  const breakfast = await createCategory(request, user.token, ledger.id, {
    name: '早餐',
    type: 'EXPENSE',
  });
  const lunch = await createCategory(request, user.token, ledger.id, {
    name: '午餐',
    type: 'EXPENSE',
  });
  const salary = (await listCategories(request, user.token, ledger.id)).find(
    (category) => category.name === '薪資' && category.type === 'INCOME',
  );
  if (!salary) {
    throw new Error('日常帳本建立後應包含預設收入分類「薪資」。');
  }

  await createTransaction(request, user.token, ledger.id, {
    type: 'EXPENSE',
    amount: 8_000,
    date: month.transactionDate,
    categoryId: breakfast.id,
    accountId,
    title: '早餐',
  });
  await createTransaction(request, user.token, ledger.id, {
    type: 'EXPENSE',
    amount: 12_000,
    date: month.transactionDate,
    categoryId: lunch.id,
    accountId,
    title: '午餐',
  });
  await createTransaction(request, user.token, ledger.id, {
    type: 'INCOME',
    amount: 5_000_000,
    date: month.transactionDate,
    categoryId: salary.id,
    accountId,
    title: '薪水',
  });

  const savings = await createAccount(request, user.token, { name: '儲蓄', initialBalance: 0 });
  await createTransaction(request, user.token, ledger.id, {
    type: 'TRANSFER',
    amount: 100_000,
    date: month.transactionDate,
    accountId,
    toAccountId: savings.id,
  });

  const badDebt = await createDebtEntry(request, user.token, {
    counterparty: { name: '小華' },
    kind: 'LEND',
    amount: 50_000,
    date: month.transactionDate,
    record: { ledgerId: ledger.id, accountId },
  });
  await forgiveCounterparty(request, user.token, badDebt.counterparty.id, { ledgerId: ledger.id });

  const borrower = await createDebtEntry(request, user.token, {
    counterparty: { name: '阿德' },
    kind: 'LEND',
    amount: 9_300,
    date: month.transactionDate,
    record: { ledgerId: ledger.id, accountId },
  });
  await createDebtEntry(request, user.token, {
    counterparty: { id: borrower.counterparty.id },
    kind: 'REPAYMENT',
    amount: 9_000,
    date: month.transactionDate,
    settle: true,
    record: { ledgerId: ledger.id, accountId },
  });

  return ledger;
}

async function expectSummary(
  page: Page,
  totals: { income: string; expense: string; net: string },
): Promise<void> {
  const summary = page.getByRole('region', { name: '收支摘要' });
  await expect(summary.getByLabel(`收入 ${totals.income}`)).toBeVisible();
  await expect(summary.getByLabel(`支出 ${totals.expense}`)).toBeVisible();
  await expect(summary.getByLabel(`結餘 ${totals.net}`)).toBeVisible();
}

function statsTabs(page: Page) {
  return page.getByRole('navigation', { name: '統計分頁' });
}

function chartSwitch(page: Page, label: string) {
  return page.getByRole('group', { name: label });
}

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectHomeAmountsOnOneLine(page: Page): Promise<void> {
  const amounts = [
    { label: '本月支出', amount: '$12,345,678' },
    { label: '本月收入', amount: '$1,234,567' },
    { label: '結餘', amount: '-$11,111,111' },
  ];

  for (const { label, amount } of amounts) {
    const card = page.getByRole('link', { name: `${label} ${amount}` });
    await expect(card).toBeVisible();
    const value = card.locator('strong');
    let metrics:
      | {
          text: string | undefined;
          lineCount: number;
          scrollWidth: number;
          clientWidth: number;
        }
      | undefined;
    await expect
      .poll(
        async () => {
          try {
            metrics = await value.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const lineRects: { top: number; bottom: number }[] = [];
              for (const rect of range.getClientRects()) {
                // 貨幣符號字級較小，同一行的 top 不同；用垂直重疊合併同一行字形。
                const line = lineRects.find(
                  (candidate) => rect.top < candidate.bottom && rect.bottom > candidate.top,
                );
                if (line) {
                  line.top = Math.min(line.top, rect.top);
                  line.bottom = Math.max(line.bottom, rect.bottom);
                } else {
                  lineRects.push({ top: rect.top, bottom: rect.bottom });
                }
              }
              return {
                text: element.textContent?.trim(),
                lineCount: lineRects.length,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
              };
            });
            return (
              metrics.text === amount &&
              metrics.lineCount === 1 &&
              metrics.scrollWidth <= metrics.clientWidth
            );
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    if (!metrics) throw new Error(`${label} 金額尚未完成版面測量。`);
    expect(metrics.text).toBe(amount);
    expect(metrics.lineCount).toBe(1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  }
}

async function expectTrendMonthRows(monthCells: Locator, singleLine: boolean): Promise<void> {
  const layouts = await monthCells.evaluateAll((cells) =>
    cells.map((cell) => {
      const parts = Array.from(cell.children);
      const year = parts[0];
      const month = parts[1];
      if (!year || !month) {
        return null;
      }

      const yearRect = year.getBoundingClientRect();
      const monthRect = month.getBoundingClientRect();
      const yearRange = document.createRange();
      yearRange.selectNodeContents(year);
      const monthRange = document.createRange();
      monthRange.selectNodeContents(month);
      const distinctLineCount = (range: Range) =>
        new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size;
      return {
        yearText: year.textContent?.trim(),
        monthText: month.textContent?.trim(),
        yearTop: yearRect.top,
        monthTop: monthRect.top,
        yearLineCount: distinctLineCount(yearRange),
        monthLineCount: distinctLineCount(monthRange),
        yearWhiteSpace: getComputedStyle(year).whiteSpace,
        monthWhiteSpace: getComputedStyle(month).whiteSpace,
      };
    }),
  );

  expect(layouts).toHaveLength(12);
  for (const layout of layouts) {
    expect(layout).not.toBeNull();
    if (!layout) {
      continue;
    }

    expect(layout.yearText).toMatch(/^\d{4}年$/);
    expect(layout.monthText).toMatch(/^\d{1,2}月$/);
    expect(layout.yearLineCount).toBe(1);
    expect(layout.monthLineCount).toBe(1);
    expect(layout.yearWhiteSpace).toBe('nowrap');
    expect(layout.monthWhiteSpace).toBe('nowrap');
    expect(layout.monthTop).toBeGreaterThanOrEqual(layout.yearTop);
    if (singleLine) {
      expect(Math.abs(layout.monthTop - layout.yearTop)).toBeLessThanOrEqual(1);
    }
  }
}

async function expectStatsTouchTargets(page: Page): Promise<void> {
  const tabButtons = statsTabs(page).getByRole('button');
  const tabCount = await tabButtons.count();
  expect(tabCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < tabCount; index += 1) {
    const height = await tabButtons
      .nth(index)
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  const chartGroups = page.getByRole('group', { name: /圖型$/ });
  const chartGroupCount = await chartGroups.count();
  expect(chartGroupCount).toBeGreaterThan(0);
  const visibleChartGroups: Locator[] = [];
  for (let index = 0; index < chartGroupCount; index += 1) {
    const chartGroup = chartGroups.nth(index);
    if (await chartGroup.isVisible()) {
      visibleChartGroups.push(chartGroup);
    }
  }
  expect(visibleChartGroups).toHaveLength(1);

  const chartButtons = visibleChartGroups[0]!.getByRole('button');
  const chartButtonCount = await chartButtons.count();
  expect(chartButtonCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < chartButtonCount; index += 1) {
    const height = await chartButtons
      .nth(index)
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

async function seedTwoLedgersForHistory(
  request: APIRequestContext,
  userA: TestUser,
  userB: TestUser,
  month: TaiwanMonth,
): Promise<{ ledgerAId: string; ledgerBId: string }> {
  await updateUserName(request, userA.token, '我');
  await updateUserName(request, userB.token, '小美');
  const accountId = await cashAccountId(request, userA);

  async function createSharedExpense(name: string, amount: number): Promise<string> {
    const ledger = await createLedger(request, userA.token, { name, kind: 'SHARED' });
    await addMember(request, userA.token, ledger.id, { email: userB.email, role: 'EDITOR' });
    const category = await createCategory(request, userA.token, ledger.id, {
      name: `${name}支出`,
      type: 'EXPENSE',
    });
    await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount,
      date: month.transactionDate,
      categoryId: category.id,
      accountId,
      title: `${name}交易`,
    });
    return ledger.id;
  }

  return {
    ledgerAId: await createSharedExpense('家用 A', 100_000),
    ledgerBId: await createSharedExpense('家用 B', 200_000),
  };
}

/** SC-R15：以 API 建立正式資料，主流程從首頁開始並在統計與交易頁走完。 */
test.describe('2j 統計頁端對端', () => {
  test('首頁長金額在 390px 與 1280px 保持單行', async ({ signedInPage: page, userA, request }) => {
    const month = currentTaiwanMonth();
    const ledger = await createLedger(request, userA.token, {
      name: '長金額測試',
      kind: 'PERSONAL',
    });
    const accountId = await cashAccountId(request, userA);
    const expenseCategory = await createCategory(request, userA.token, ledger.id, {
      name: '大額支出',
      type: 'EXPENSE',
    });
    const incomeCategory = await createCategory(request, userA.token, ledger.id, {
      name: '大額收入',
      type: 'INCOME',
    });

    await createTransaction(request, userA.token, ledger.id, {
      type: 'EXPENSE',
      amount: 1_234_567_800,
      date: month.transactionDate,
      categoryId: expenseCategory.id,
      accountId,
      title: '大額支出',
    });
    await createTransaction(request, userA.token, ledger.id, {
      type: 'INCOME',
      amount: 123_456_700,
      date: month.transactionDate,
      categoryId: incomeCategory.id,
      accountId,
      title: '大額收入',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('ledger.theme', value), theme);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await switchLedger(page, ledger.name);
      await expectHomeAmountsOnOneLine(page);
      await expectHomeSectionOrder(page, 390);
      await expectNoHorizontalPageScroll(page);

      if (theme === 'light') {
        await page.setViewportSize({ width: 1280, height: 844 });
        await expectHomeAmountsOnOneLine(page);
        await expectHomeSectionOrder(page, 1280);
        await expectNoHorizontalPageScroll(page);
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
  });

  test('SC-R15：家用首頁、分類、趨勢、成員與相關交易', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    const month = currentTaiwanMonth();
    const household = await seedHousehold(request, userA, userB, month);
    await page.reload();
    await switchLedger(page, '家用');

    const expenseCard = page.getByRole('link', { name: '本月支出 $1,200 我 $450' });
    await expect(expenseCard).toBeVisible();
    await expect(page.getByRole('link', { name: '本月收入 $200 我 $200' })).toBeVisible();
    await expect(page.getByRole('link', { name: '結餘 -$1,000 我 -$250' })).toBeVisible();

    await expenseCard.click();
    await expect(page.getByRole('heading', { level: 2, name: '統計' })).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('ledger'))
      .toBe(household.ledger.id);
    await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(month.value);
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('cat');
    await expect(page.getByText(periodLabel(month.value), { exact: true })).toBeVisible();
    await expectSummary(page, { income: '$200', expense: '$1,200', net: '-$1,000' });

    const categories = page.getByRole('list', { name: '支出分類清單' });
    await expect(
      chartSwitch(page, '分類圖型').getByRole('button', { name: '圓餅' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(categories.getByRole('listitem')).toHaveCount(2);
    await expect(categories.getByRole('button', { name: '晚餐，$900，75%' })).toBeVisible();
    await expect(categories.getByRole('button', { name: '日用品，$300，25%' })).toBeVisible();

    const perspective = page.getByRole('group', { name: '統計口徑' });
    await perspective.getByRole('button', { name: '我', exact: true }).click();
    await expect(categories.getByRole('listitem')).toHaveCount(1);
    await expect(categories.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
      '$450',
    );
    await expect(categories.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
      '100%',
    );
    await chartSwitch(page, '分類圖型').getByRole('button', { name: '長條' }).click();
    await expect(categories.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
      '$450',
    );
    await expect(categories.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
      '100%',
    );
    await expectSummary(page, { income: '$200', expense: '$450', net: '-$250' });

    await perspective.getByRole('button', { name: '帳本', exact: true }).click();
    await statsTabs(page).getByRole('button', { name: '趨勢' }).click();
    const trendList = page.getByRole('list', { name: '每月收支' });
    await expect(trendList.getByRole('listitem')).toHaveCount(12);
    await expect(
      trendList.getByRole('button', {
        name: `${trendMonthLabel(month.value)}，收入 $200，支出 $1,200，結餘 -$1,000`,
      }),
    ).toBeVisible();
    const previousMonth = shiftMonth(month.value, -1);
    await expect(
      trendList.getByRole('button', {
        name: `${trendMonthLabel(previousMonth)}，收入 $0，支出 $0，結餘 $0`,
      }),
    ).toBeVisible();
    await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '折線' }).click();
    await expect(page.getByRole('region', { name: '趨勢折線圖' })).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `${trendMonthLabel(month.value)}：收入 $200，支出 $1,200，結餘 -$1,000`,
      }),
    ).toBeVisible();
    await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '表格' }).click();
    const trendTable = page.getByRole('table', { name: '趨勢表格' });
    await expect(trendTable).toBeVisible();
    await expect(trendTable.getByRole('row')).toHaveCount(13);
    const currentMonthRow = trendTable.getByRole('row', {
      name: new RegExp(trendMonthLabel(month.value)),
    });
    await expect(currentMonthRow).toContainText('$200');
    await expect(currentMonthRow).toContainText('$1,200');
    await expect(currentMonthRow).toContainText('-$1,000');

    await statsTabs(page).getByRole('button', { name: '成員' }).click();
    const members = page.getByRole('list', { name: '成員收支' });
    await expect(members.getByRole('listitem', { name: '我，支出 $450，收入 $200' })).toBeVisible();
    await expect(members.getByRole('listitem', { name: '小美，支出 $750，收入 $0' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('perspective')).toBe('LEDGER');

    await statsTabs(page).getByRole('button', { name: '分類' }).click();
    const dinnerRequestPromise = page.waitForRequest((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.method() === 'GET' &&
        url.pathname.endsWith(`/ledgers/${household.ledger.id}/transactions`) &&
        url.searchParams.get('categoryId') === household.dinnerCategoryId
      );
    });
    await page
      .getByRole('list', { name: '支出分類清單' })
      .getByRole('button', { name: /^晚餐，\$900，/ })
      .click();
    const dinnerRequest = new URL((await dinnerRequestPromise).url());
    expect(dinnerRequest.searchParams.get('ledger')).toBeNull();
    expect(dinnerRequest.searchParams.get('categoryId')).toBe(household.dinnerCategoryId);
    expect(dinnerRequest.searchParams.get('page')).toBe('1');
    await expect(page.getByRole('heading', { level: 2, name: '交易', exact: true })).toBeVisible();

    const transactionUrl = new URL(page.url());
    expect(transactionUrl.searchParams.get('ledger')).toBe(household.ledger.id);
    expect(transactionUrl.searchParams.get('categoryId')).toBe(household.dinnerCategoryId);
    expect(transactionUrl.searchParams.get('type')).toBe('EXPENSE');
    expect(transactionUrl.searchParams.get('from')).toBe(month.from);
    expect(transactionUrl.searchParams.get('to')).toBe(month.to);
    expect([...transactionUrl.searchParams.keys()].sort()).toEqual(
      ['categoryId', 'from', 'ledger', 'to', 'type'].sort(),
    );
    await expect(page.getByRole('group', { name: '作用中帳本' })).toContainText('家用');
    const transactionFilters = page.getByRole('region', { name: '篩選交易' });
    await expect(transactionFilters.getByRole('combobox', { name: '型別' })).toHaveValue('EXPENSE');
    await expect(transactionFilters.getByRole('combobox', { name: '分類' })).toHaveValue(
      household.dinnerCategoryId,
    );
    await expect(transactionFilters.getByRole('textbox', { name: '起日' })).toHaveValue(month.from);
    await expect(transactionFilters.getByRole('textbox', { name: '迄日' })).toHaveValue(month.to);
    await expect(
      page.getByRole('button', { name: /^編輯\d{4}\/\d{2}\/01 的晚餐 晚餐$/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /衛生紙/ })).toHaveCount(0);
  });

  test('SC-R15：日常首頁摘要與分類固定分組', async ({ signedInPage: page, userA, request }) => {
    const month = currentTaiwanMonth();
    const ledger = await seedDailyLedger(request, userA, month);
    await page.reload();
    await switchLedger(page, '日常');

    await expect(page.getByRole('link', { name: '本月支出 $703' })).toBeVisible();
    await expect(page.getByRole('link', { name: '本月收入 $50,000' })).toBeVisible();
    const balanceCard = page.getByRole('link', { name: '結餘 $49,297' });
    await expect(balanceCard).toBeVisible();
    await balanceCard.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('ledger')).toBe(ledger.id);

    const categories = page.getByRole('list', { name: '支出分類清單' });
    await expect(categories.getByRole('listitem')).toHaveCount(4);
    await expect(categories.getByRole('listitem').filter({ hasText: '呆帳' })).toContainText(
      '$500',
    );
    await expect(categories.getByRole('listitem').filter({ hasText: '午餐' })).toContainText(
      '$120',
    );
    await expect(categories.getByRole('listitem').filter({ hasText: '早餐' })).toContainText('$80');
    await expect(categories.getByRole('listitem').filter({ hasText: '結清差額' })).toContainText(
      '$3',
    );
  });

  test('SC-R20：網址狀態可重整分享並以返回鍵還原帳本', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    const month = currentTaiwanMonth();
    const { ledgerAId, ledgerBId } = await seedTwoLedgersForHistory(request, userA, userB, month);
    const previousMonth = shiftMonth(month.value, -1);
    await page.goto(statsPath(ledgerAId, month.value));
    await expect(page.getByRole('heading', { level: 2, name: '統計' })).toBeVisible();

    await statsTabs(page).getByRole('button', { name: '趨勢' }).click();
    await page.getByRole('button', { name: '上一個月' }).click();
    await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '折線' }).click();
    await page.getByRole('group', { name: '統計口徑' }).getByRole('button', { name: '我' }).click();
    await page.reload();

    async function expectSharedUrlState(target: Page): Promise<void> {
      await expect.poll(() => new URL(target.url()).searchParams.get('tab')).toBe('trend');
      await expect.poll(() => new URL(target.url()).searchParams.get('ledger')).toBe(ledgerAId);
      await expect.poll(() => new URL(target.url()).searchParams.get('month')).toBe(previousMonth);
      await expect.poll(() => new URL(target.url()).searchParams.get('perspective')).toBe('MINE');
      await expect.poll(() => new URL(target.url()).searchParams.get('chart')).toBe('line');
      await expect(statsTabs(target).getByRole('button', { name: '趨勢' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(
        chartSwitch(target, '趨勢圖型').getByRole('button', { name: '折線' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        target.getByRole('group', { name: '統計口徑' }).getByRole('button', { name: '我' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(target.getByText(periodLabel(previousMonth), { exact: true })).toBeVisible();
    }

    await expectSharedUrlState(page);
    const copiedPage = await page.context().newPage();
    try {
      await copiedPage.goto(page.url());
      await expectSharedUrlState(copiedPage);

      await copiedPage.goto(
        `/stats?tab=xxx&ledger=${encodeURIComponent(ledgerAId)}&month=${month.value}&perspective=xxx&chart=xxx`,
      );
      await expect.poll(() => new URL(copiedPage.url()).searchParams.get('tab')).toBe('cat');
      await expect
        .poll(() => new URL(copiedPage.url()).searchParams.get('month'))
        .toBe(month.value);
      await expect
        .poll(() => new URL(copiedPage.url()).searchParams.get('perspective'))
        .toBe('LEDGER');
      await expect.poll(() => new URL(copiedPage.url()).searchParams.get('chart')).toBe('donut');
      await expect(
        chartSwitch(copiedPage, '分類圖型').getByRole('button', { name: '圓餅' }),
      ).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await copiedPage.close();
    }

    await statsTabs(page).getByRole('button', { name: '分類' }).click();
    await page.getByRole('button', { name: '下一個月' }).click();
    await page
      .getByRole('group', { name: '統計口徑' })
      .getByRole('button', { name: '帳本' })
      .click();
    await expectSummary(page, { income: '$0', expense: '$1,000', net: '-$1,000' });

    const ledgerSwitcher = page.getByRole('group', { name: '作用中帳本' });
    await ledgerSwitcher.getByRole('button').click();
    await ledgerSwitcher.getByRole('option', { name: /家用 B/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('ledger')).toBe(ledgerBId);
    await expectSummary(page, { income: '$0', expense: '$2,000', net: '-$2,000' });

    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get('ledger')).toBe(ledgerAId);
    await expectSummary(page, { income: '$0', expense: '$1,000', net: '-$1,000' });
  });

  test('SC-R21：390px 淺色與深色的每個分頁及圖型不橫向溢位', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    const month = currentTaiwanMonth();
    await updateUserName(request, userA.token, '我');
    await updateUserName(request, userB.token, LONG_MEMBER_NAME);
    const ledger = await createLedger(request, userA.token, { name: '手機統計', kind: 'SHARED' });
    await addMember(request, userA.token, ledger.id, { email: userB.email, role: 'EDITOR' });
    const people = await listLedgerPeople(request, userA.token, ledger.id);
    const member = people.find((person) => person.userId === userB.id);
    if (!member) {
      throw new Error('手機測試帳本應列出長名稱成員。');
    }
    const accountId = await cashAccountId(request, userA);

    const expenseCategories = [];
    for (let index = 0; index < 15; index += 1) {
      expenseCategories.push(
        await createCategory(request, userA.token, ledger.id, {
          name: index === 0 ? LONG_CATEGORY_NAME : `手機分類${String(index + 1).padStart(2, '0')}`,
          type: 'EXPENSE',
        }),
      );
    }

    // 單筆金額遵守 API 上限，以多筆交易組成 9 位數元的分類總額。
    const largeCategoryAmounts = [
      2_000_000_000, 2_000_000_000, 2_000_000_000, 2_000_000_000, 2_000_000_000, 2_000_000_000,
      345_678_900,
    ];
    for (const amount of largeCategoryAmounts) {
      await createTransaction(request, userA.token, ledger.id, {
        type: 'EXPENSE',
        amount,
        date: month.transactionDate,
        categoryId: expenseCategories[0]!.id,
        accountId,
        title: LONG_CATEGORY_NAME,
      });
    }
    for (let index = 1; index < expenseCategories.length; index += 1) {
      await createTransaction(request, userA.token, ledger.id, {
        type: 'EXPENSE',
        amount: 10_000,
        date: month.transactionDate,
        categoryId: expenseCategories[index]!.id,
        title: `手機分類${String(index + 1).padStart(2, '0')}`,
        ...(index === 1 ? { payerPersonId: member.id } : { accountId }),
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const path = statsPath(ledger.id, month.value);

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('ledger.theme', value), theme);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const categoryList = page.getByRole('list', { name: '支出分類清單' });
      await expect(categoryList.getByRole('listitem')).toHaveCount(15);
      const longCategoryButton = categoryList.getByRole('button', {
        name: new RegExp(`^${LONG_CATEGORY_NAME}，\\$123,456,789，`),
      });
      await expect(longCategoryButton).toBeVisible();
      const longCategoryText = longCategoryButton.getByText(LONG_CATEGORY_NAME, { exact: true });
      await expect(longCategoryText).toBeVisible();
      await expect(longCategoryButton).toHaveAccessibleName(
        new RegExp(`^${LONG_CATEGORY_NAME}，\\$123,456,789，`),
      );
      const categoryTextMetrics = await longCategoryText.evaluate((element) => ({
        text: element.textContent?.trim(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        textOverflow: getComputedStyle(element).textOverflow,
      }));
      expect(categoryTextMetrics.text).toBe(LONG_CATEGORY_NAME);
      expect(categoryTextMetrics.scrollWidth).toBeLessThanOrEqual(categoryTextMetrics.clientWidth);
      expect(categoryTextMetrics.textOverflow).not.toBe('ellipsis');

      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      await chartSwitch(page, '分類圖型').getByRole('button', { name: '長條' }).click();
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);

      await statsTabs(page).getByRole('button', { name: '趨勢' }).click();
      await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '長條' }).click();
      const trendBarMonths = page.getByRole('list', { name: '每月收支' });
      await expect(trendBarMonths.getByRole('listitem')).toHaveCount(12);
      await expectCompactMonthLabels(
        trendBarMonths.locator('button > span:nth-of-type(2)'),
        trendBarMonths.getByRole('button'),
      );
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '折線' }).click();
      const lineChart = page.getByRole('region', { name: '趨勢折線圖' });
      await expect(lineChart).toBeVisible();
      const polylines = lineChart.locator('svg polyline');
      await expect(polylines).toHaveCount(2);
      expect(
        await polylines.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fill),
        ),
      ).toEqual(['none', 'none']);
      const pointFills = await lineChart
        .locator('svg circle')
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fill));
      expect(pointFills.length).toBeGreaterThan(0);
      expect(pointFills).not.toContain('none');
      const lineLabels = lineChart.locator('ol[aria-hidden="true"] > li');
      const linePoints = lineChart.locator('svg circle');
      await expectResponsiveLineMonthLabels(lineLabels, lineChart.locator('button'), 6);
      await expectResponsiveLineMonthPositions(lineLabels, linePoints);
      await expectMonthLabelGaps(lineLabels);
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      if (theme === 'light') {
        await page.setViewportSize({ width: 1280, height: 844 });
        await expectResponsiveLineMonthLabels(lineLabels, lineChart.locator('button'), 12);
        await expectResponsiveLineMonthPositions(lineLabels, linePoints);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await chartSwitch(page, '趨勢圖型').getByRole('button', { name: '表格' }).click();
      const trendTable = page.getByRole('table', { name: '趨勢表格' });
      await expect(trendTable).toBeVisible();
      const monthCells = trendTable.getByRole('rowheader');
      await expect(monthCells).toHaveCount(12);
      for (const cell of await monthCells.all()) {
        const parts = await cell.evaluate((element) =>
          Array.from(element.children, (child) => child.textContent?.trim() ?? ''),
        );
        expect(parts).toHaveLength(2);
        expect(parts[0]).toMatch(/^\d{4}年$/);
        expect(parts[1]).toMatch(/^\d{1,2}月$/);
        expect((await cell.innerText()).replace(/\s/g, '')).toBe(`${parts[0]}${parts[1]}`);
      }
      await expectTrendMonthRows(monthCells, false);
      if (theme === 'light') {
        await page.setViewportSize({ width: 1280, height: 844 });
        await expectTrendMonthRows(monthCells, true);
        await expectNoHorizontalPageScroll(page);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);

      await statsTabs(page).getByRole('button', { name: '成員' }).click();
      const members = page.getByRole('list', { name: '成員收支' });
      const longMember = members.getByRole('listitem', {
        name: new RegExp(`^${LONG_MEMBER_NAME}，`),
      });
      await expect(longMember).toBeVisible();
      const longMemberText = longMember.getByText(LONG_MEMBER_NAME, { exact: true });
      await expect(longMemberText).toBeVisible();
      const memberTextMetrics = await longMemberText.evaluate((element) => ({
        text: element.textContent?.trim(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        textOverflow: getComputedStyle(element).textOverflow,
      }));
      expect(memberTextMetrics.text).toBe(LONG_MEMBER_NAME);
      expect(memberTextMetrics.scrollWidth).toBeLessThanOrEqual(memberTextMetrics.clientWidth);
      expect(memberTextMetrics.textOverflow).not.toBe('ellipsis');
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      await chartSwitch(page, '成員圖型').getByRole('button', { name: '圓餅' }).click();
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
    }
  });
});
