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
 * 日期以台灣時區動態計算；390px 情境逐一檢查各分頁、長文字與觸控區。
 */

const LONG_CATEGORY_NAME = '超長分類名稱驗證文字'.repeat(4);
const LONG_MEMBER_NAME = '測試共享帳本成員名稱完整顯示確認'.repeat(3);

async function expectMonthLabelGaps(labels: Locator): Promise<void> {
  const visibleLabels = labels.filter({ visible: true });
  const count = await visibleLabels.count();
  expect(count).toBeGreaterThan(0);
  await expect(async () => {
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
  }).toPass({ timeout: 5_000 });
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

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      return dimensions.scrollWidth - dimensions.clientWidth;
    })
    .toBeLessThanOrEqual(0);
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

async function expectStatsTouchTargets(page: Page): Promise<void> {
  const tabButtons = statsTabs(page).getByRole('button');
  const tabCount = await tabButtons.count();
  expect(tabCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < tabCount; index += 1) {
    await expect
      .poll(() =>
        tabButtons.nth(index).evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThanOrEqual(44);
  }

  await expect(page.getByRole('group', { name: /圖型$/ })).toHaveCount(0);
  for (const button of await page
    .getByRole('group', { name: /收支方向$/ })
    .getByRole('button')
    .all()) {
    await expect
      .poll(() => button.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(44);
  }
}

async function expectListBars(list: Locator): Promise<void> {
  const rows = list.getByRole('listitem');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row.getByTestId('statistics-list-bar')).toHaveCount(1);
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
    await expect(page.getByRole('group', { name: '分類圖型' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '支出分類圓餅圖' })).toBeVisible();
    await expect(categories.getByRole('listitem')).toHaveCount(2);
    await expectListBars(categories);
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
    await expectListBars(categories);
    await expectSummary(page, { income: '$200', expense: '$450', net: '-$250' });

    await perspective.getByRole('button', { name: '帳本', exact: true }).click();
    await statsTabs(page).getByRole('button', { name: '趨勢' }).click();
    const trendChart = page.getByRole('region', { name: '收支趨勢圖' });
    await expect(trendChart.getByRole('button')).toHaveCount(12);
    const currentMonth = trendChart.getByRole('button', {
      name: `${trendMonthLabel(month.value)}：收入 $200，支出 $1,200，結餘 -$1,000`,
    });
    const previousMonth = shiftMonth(month.value, -1);
    await expect(
      trendChart.getByRole('button', {
        name: `${trendMonthLabel(previousMonth)}：收入 $0，支出 $0，結餘 $0`,
      }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: '趨勢圖型' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: '趨勢表格' })).toHaveCount(0);
    const plot = trendChart.locator('svg');
    await plot.scrollIntoViewIfNeeded();
    await currentMonth.focus();
    await expect(trendChart.locator('dl')).toHaveCount(0);
    const topBefore = (await plot.boundingBox())!.y;
    await currentMonth.press('ArrowLeft');
    await expect(
      trendChart.getByRole('button', { name: new RegExp(trendMonthLabel(previousMonth)) }),
    ).toBeFocused();
    await expect(trendChart.locator('dl')).toContainText('$0');
    expect(Math.abs((await plot.boundingBox())!.y - topBefore)).toBeLessThanOrEqual(1);
    const zeroY = Number(await plot.locator('[data-trend-zero]').getAttribute('y1'));
    expect(
      Number(await currentMonth.locator('[data-series="net"]').getAttribute('cy')),
    ).toBeGreaterThan(zeroY);
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(previousMonth);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(month.value);

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
    await page.getByRole('group', { name: '統計口徑' }).getByRole('button', { name: '我' }).click();
    await page.reload();

    async function expectSharedUrlState(target: Page): Promise<void> {
      await expect.poll(() => new URL(target.url()).searchParams.get('tab')).toBe('trend');
      await expect.poll(() => new URL(target.url()).searchParams.get('ledger')).toBe(ledgerAId);
      await expect.poll(() => new URL(target.url()).searchParams.get('month')).toBe(previousMonth);
      await expect.poll(() => new URL(target.url()).searchParams.get('perspective')).toBe('MINE');
      await expect.poll(() => new URL(target.url()).searchParams.get('chart')).toBeNull();
      await expect(statsTabs(target).getByRole('button', { name: '趨勢' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(target.getByRole('region', { name: '收支趨勢圖' })).toBeVisible();
      await expect(
        target.getByRole('group', { name: '統計口徑' }).getByRole('button', { name: '我' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(target.getByText(periodLabel(previousMonth), { exact: true })).toBeVisible();
    }

    await expectSharedUrlState(page);
    const copiedPage = await page.context().newPage();
    try {
      const legacyUrl = new URL(page.url());
      legacyUrl.searchParams.set('chart', 'table');
      await copiedPage.goto(legacyUrl.href);
      await expectSharedUrlState(copiedPage);

      const normalizedTrendUrl = copiedPage.url();
      await copiedPage.goto('/stats?tab=cat&chart=bar');
      await expect.poll(() => new URL(copiedPage.url()).searchParams.get('chart')).toBeNull();
      await expect(copiedPage.getByRole('list', { name: '支出分類清單' })).toBeVisible();
      await copiedPage.goBack();
      await expect(copiedPage).toHaveURL(normalizedTrendUrl);

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
      await expect.poll(() => new URL(copiedPage.url()).searchParams.get('chart')).toBeNull();
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

  test('SC-R21：390px 淺色與深色的每個分頁都不橫向溢位', async ({
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
      const tabs = await statsTabs(page).boundingBox();
      expect(tabs).not.toBeNull();
      for (const name of ['收支摘要', '分類']) {
        const card = await page.getByRole('region', { name, exact: true }).boundingBox();
        expect(card).not.toBeNull();
        expect(Math.abs(tabs!.x - card!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(tabs!.x + tabs!.width - (card!.x + card!.width))).toBeLessThanOrEqual(1);
      }
      const longCategoryButton = categoryList.getByRole('button', {
        name: new RegExp(`^${LONG_CATEGORY_NAME}，\\$123,456,789，`),
      });
      await expect(longCategoryButton).toBeVisible();
      const longCategoryText = longCategoryButton.getByText(LONG_CATEGORY_NAME, { exact: true });
      await expect(longCategoryText).toBeVisible();
      await expect(longCategoryButton).toHaveAccessibleName(
        new RegExp(`^${LONG_CATEGORY_NAME}，\\$123,456,789，`),
      );
      await expect(async () => {
        const categoryTextMetrics = await longCategoryText.evaluate((element) => ({
          text: element.textContent?.trim(),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          textOverflow: getComputedStyle(element).textOverflow,
        }));
        expect(categoryTextMetrics.text).toBe(LONG_CATEGORY_NAME);
        expect(categoryTextMetrics.scrollWidth).toBeLessThanOrEqual(
          categoryTextMetrics.clientWidth,
        );
        expect(categoryTextMetrics.textOverflow).not.toBe('ellipsis');
      }).toPass({ timeout: 5_000 });

      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      await expectListBars(page.getByRole('list', { name: '支出分類清單' }));

      await statsTabs(page).getByRole('button', { name: '趨勢' }).click();
      const trendChart = page.getByRole('region', { name: '收支趨勢圖' });
      await expect(trendChart.getByRole('button')).toHaveCount(12);
      for (const series of ['income', 'expense', 'net']) {
        await expect(trendChart.locator('[data-series="' + series + '"]')).toHaveCount(12);
      }
      const line = trendChart.locator('polyline');
      await expect(line).toHaveCount(1);
      await expect(line).toHaveCSS('fill', 'none');
      const labels = trendChart.locator('[data-month-label]');
      await expect(labels).toHaveCount(6);
      await expectMonthLabelGaps(labels);
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      if (theme === 'light') {
        await page.setViewportSize({ width: 1280, height: 844 });
        await expect(labels).toHaveCount(12);
        await expectMonthLabelGaps(labels);
        await expectNoHorizontalPageScroll(page);
        await page.setViewportSize({ width: 390, height: 844 });
      }

      await statsTabs(page).getByRole('button', { name: '成員' }).click();
      const members = page.getByRole('list', { name: '成員收支' });
      const longMember = members.getByRole('listitem', {
        name: new RegExp(`^${LONG_MEMBER_NAME}，`),
      });
      await expect(longMember).toBeVisible();
      const longMemberText = longMember.getByText(LONG_MEMBER_NAME, { exact: true });
      await expect(longMemberText).toBeVisible();
      await expect(async () => {
        const memberTextMetrics = await longMemberText.evaluate((element) => ({
          text: element.textContent?.trim(),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          textOverflow: getComputedStyle(element).textOverflow,
        }));
        expect(memberTextMetrics.text).toBe(LONG_MEMBER_NAME);
        expect(memberTextMetrics.scrollWidth).toBeLessThanOrEqual(memberTextMetrics.clientWidth);
        expect(memberTextMetrics.textOverflow).not.toBe('ellipsis');
      }).toPass({ timeout: 5_000 });
      await expectNoHorizontalPageScroll(page);
      await expectStatsTouchTargets(page);
      await expect(page.getByRole('region', { name: '成員支出圓餅圖' })).toBeVisible();
      await expectListBars(members);
    }
  });
});
