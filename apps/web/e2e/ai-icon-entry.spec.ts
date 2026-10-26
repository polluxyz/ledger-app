import { formatMoney } from '../src/lib/format';
import {
  addMember,
  createAccount,
  createCategory,
  createLedger,
  createTransaction,
  listAccounts,
  listLedgerTransactions,
  personalLedger,
  updateMemberRole,
} from './api';
import { expect, test } from './fixtures';
import {
  homeActivityRow,
  newTransactionForm,
  openDashboard,
  openTransactions,
  switchLedger,
} from './ui';

const TWO_MEALS_TEXT = '早餐 60 現金、午餐 120 刷卡';

/**
 * 新入口的瀏覽器驗收：真實 API 建立帳務資料，假 provider 負責回傳固定草稿。
 * 門檻情境用 Playwright route 延遲同一個真實請求，檢查跨頁共用與寫入鎖。
 */
test.describe('AI 記帳圖示入口', () => {
  test('SC-P28：沒有帳本時隱藏入口，也不送解析請求', async ({ signedInPage: page }) => {
    let parseRequests = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET' && url.pathname.endsWith('/ledgers')) {
        await route.fulfill({ json: [] });
        return;
      }
      if (route.request().method() === 'POST' && url.pathname.endsWith('/ai/parse-transaction')) {
        parseRequests += 1;
      }
      await route.continue();
    });

    await page.reload();
    await expect(page.getByRole('button', { name: /^AI 記帳/ })).toHaveCount(0);
    expect(parseRequests).toBe(0);
  });

  test('SC-P28：錯誤浮層不改變橫條高度，收起後可重新展開查看原句與錯誤', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    await createPersonalAiCatalog(request, userA.token);
    await page.route('**/ai/parse-transaction', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 503,
          errorCode: 'AI_UNAVAILABLE',
          message: 'provider detail must not reach the UI',
        }),
      }),
    );
    await page.reload();
    await openDashboard(page);

    const toggle = page.getByRole('button', { name: 'AI 記帳', exact: true });
    const collapsedHeight = await toolbarHeight(toggle);
    await toggle.click();
    const input = page.getByRole('textbox', { name: '用一句話記帳' });
    await expect(input).toBeFocused();
    const expandedHeight = await toolbarHeight(toggle);
    expect(expandedHeight).toBe(collapsedHeight);

    await input.fill('早餐 60 現金');
    await page.getByRole('button', { name: '送出', exact: true }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('AI 暫時沒有回應，請稍後再試。');
    expect(await toolbarHeight(toggle)).toBe(collapsedHeight);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(alert).toHaveAttribute('aria-live', 'polite');
    await expect(toggle).toHaveAttribute('data-error', 'true');
    await toggle.click();
    await expect(input).toHaveValue('早餐 60 現金');
    await expect(alert).toBeVisible();
    expect(await toolbarHeight(toggle)).toBe(collapsedHeight);
  });

  test('SC-P28：檢視者可聚焦看到提示，借還與其他頁不顯示入口', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    const shared = await createLedger(request, userB.token, {
      name: '唯讀帳本',
      kind: 'SHARED',
    });
    await addMember(request, userB.token, shared.id, {
      email: userA.email,
      role: 'VIEWER',
    });
    let parseRequests = 0;
    await page.route('**/ai/parse-transaction', async (route) => {
      parseRequests += 1;
      await route.continue();
    });
    await page.reload();
    await switchLedger(page, shared.name);

    const viewerEntry = page.getByRole('button', { name: 'AI 記帳：只能檢視', exact: true });
    await expect(viewerEntry).toHaveAttribute('aria-disabled', 'true');
    await viewerEntry.focus();
    await expect(page.getByRole('tooltip', { name: '只能檢視' })).toBeVisible();
    await viewerEntry.click();
    await expect(page.getByRole('textbox', { name: '用一句話記帳' })).toHaveCount(0);
    expect(parseRequests).toBe(0);

    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('link', { name: '帳戶' })
      .click();
    await expect(page.getByRole('button', { name: /^AI 記帳/ })).toHaveCount(0);
    await openDebtsView(page);
    await expect(page.getByRole('button', { name: /^AI 記帳/ })).toHaveCount(0);
    expect(parseRequests).toBe(0);
  });

  test('SC-P29：首頁完成第 1～4 步，儲存後最近交易與帳戶餘額即時更新', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { personal, cash, credit, breakfastCategory } = await createPersonalAiCatalog(
      request,
      userA.token,
    );
    await createTransaction(request, userA.token, personal.id, {
      type: 'EXPENSE',
      amount: 100,
      date: new Date().toISOString().slice(0, 10),
      title: '首頁 AI 預設帳戶前置',
      categoryId: breakfastCategory.id,
      accountId: cash.id,
    });
    await page.reload();
    await openDashboard(page);

    await submitFromCurrentPage(page, TWO_MEALS_TEXT);
    const breakfastConfirm = page.getByRole('button', { name: '確認草稿：早餐', exact: true });
    await expect(breakfastConfirm).toBeVisible();
    await expect(page.getByRole('button', { name: '編輯草稿：午餐', exact: true })).toBeVisible();
    await breakfastConfirm.click();
    await expect(homeActivityRow(page, '-$60')).toContainText('早餐');

    const accountsAfterBreakfast = await listAccounts(request, userA.token);
    const cashAfterBreakfast = accountsAfterBreakfast.find((account) => account.id === cash.id);
    if (!cashAfterBreakfast) throw new Error('找不到首頁現金帳戶。');
    await expect(page.getByLabel(`${cash.name}餘額`)).toHaveText(
      formatMoney(cashAfterBreakfast.balance),
    );

    await page.getByRole('button', { name: '編輯草稿：午餐', exact: true }).click();
    const form = newTransactionForm(page);
    await form.getByLabel('金額').fill('125');
    await form.getByRole('button', { name: '新增', exact: true }).click();
    await expect(homeActivityRow(page, '-$125')).toContainText('午餐');
    await expect(page.getByRole('button', { name: '編輯草稿：午餐', exact: true })).toHaveCount(0);

    const accountsAfterLunch = await listAccounts(request, userA.token);
    const creditAfterLunch = accountsAfterLunch.find((account) => account.id === credit.id);
    if (!creditAfterLunch) throw new Error('找不到首頁信用卡帳戶。');
    await expect(page.getByLabel(`${credit.name}餘額`)).toHaveText(
      formatMoney(creditAfterLunch.balance),
    );
  });

  test('SC-P29/30：解析中切換帳本與頁面不丟回應，第二頁不能再送解析', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { personal } = await createPersonalAiCatalog(request, userA.token);
    const otherLedger = await createLedger(request, userA.token, { name: '解析中切換帳本' });
    let releaseParse: (() => void) | undefined;
    const parseGate = new Promise<void>((resolve) => {
      releaseParse = resolve;
    });
    let parseRequests = 0;
    await page.route('**/ai/parse-transaction', async (route) => {
      parseRequests += 1;
      await parseGate;
      await route.continue();
    });

    try {
      await page.reload();
      await openTransactions(page);
      await submitFromCurrentPage(page, '早餐 60 現金');
      await expect.poll(() => parseRequests).toBe(1);

      await switchLedger(page, otherLedger.name);
      await openDashboard(page);
      await page.getByRole('button', { name: 'AI 記帳', exact: true }).click();
      const input = page.getByRole('textbox', { name: '用一句話記帳' });
      await expect(input).toBeDisabled();
      await expect(page.getByRole('button', { name: '送出', exact: true })).toBeDisabled();
      expect(parseRequests).toBe(1);

      releaseParse?.();
      await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toBeVisible();
      const draftRow = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: '編輯草稿：早餐', exact: true }),
      });
      await expect(draftRow).toContainText(personal.name);
      await expect(draftRow).not.toContainText(otherLedger.name);
      expect(parseRequests).toBe(1);
    } finally {
      releaseParse?.();
    }
  });

  test('SC-P29：登出並登入另一位使用者後丟掉舊解析回應', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    await createPersonalAiCatalog(request, userA.token);
    let releaseParse: (() => void) | undefined;
    const parseGate = new Promise<void>((resolve) => {
      releaseParse = resolve;
    });
    let parseRequests = 0;
    await page.route('**/ai/parse-transaction', async (route) => {
      parseRequests += 1;
      await parseGate;
      await route.continue();
    });

    try {
      await page.reload();
      await openDashboard(page);
      await submitFromCurrentPage(page, '早餐 60 現金');
      const parseResponse = page.waitForResponse((response) =>
        response.url().includes('/ai/parse-transaction'),
      );
      await expect.poll(() => parseRequests).toBe(1);

      await page.getByRole('button', { name: /的選單$|^帳號選單$/ }).click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      await page.getByRole('button', { name: '登入', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Email').fill(userB.email);
      await dialog.getByLabel('密碼').fill('sup3rsecret');
      await dialog.getByRole('button', { name: '登入', exact: true }).click();
      await expect(page.getByRole('button', { name: 'AI 記帳', exact: true })).toBeVisible();

      releaseParse?.();
      await (await parseResponse).finished();
      await expect(page.getByRole('heading', { name: '草稿' })).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(parseRequests).toBe(1);
    } finally {
      releaseParse?.();
    }
  });

  test('SC-P30：全部確認固定候選名單，新到草稿留在清單', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { breakfastCategory, personal, cash } = await createPersonalAiCatalog(
      request,
      userA.token,
    );
    await createTransaction(request, userA.token, personal.id, {
      type: 'EXPENSE',
      amount: 100,
      date: new Date().toISOString().slice(0, 10),
      title: '全部確認預設帳戶前置',
      categoryId: breakfastCategory.id,
      accountId: cash.id,
    });
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let transactionPosts = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() === 'POST' &&
        /\/ledgers\/[^/]+\/transactions$/.test(url.pathname)
      ) {
        transactionPosts += 1;
        if (transactionPosts === 1) await firstWriteGate;
      }
      await route.continue();
    });

    try {
      await page.reload();
      await openDashboard(page);
      await submitFromCurrentPage(page, TWO_MEALS_TEXT);
      await expect(page.getByRole('button', { name: '確認草稿：早餐', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '全部確認', exact: true }).click();
      await expect.poll(() => transactionPosts).toBe(1);

      await submitFromCurrentPage(page, '早餐 60 現金');
      await expect(page.getByRole('button', { name: /^確認草稿：/ })).toHaveCount(3);
      releaseFirstWrite?.();

      await expect.poll(() => transactionPosts).toBe(2);
      await expect(page.getByRole('button', { name: /^確認草稿：/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toBeVisible();
    } finally {
      releaseFirstWrite?.();
    }
  });

  test('SC-P30：登出後全部確認不再送出下一筆交易', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { breakfastCategory, personal, cash } = await createPersonalAiCatalog(
      request,
      userA.token,
    );
    await createTransaction(request, userA.token, personal.id, {
      type: 'EXPENSE',
      amount: 100,
      date: new Date().toISOString().slice(0, 10),
      title: '登出批次預設帳戶前置',
      categoryId: breakfastCategory.id,
      accountId: cash.id,
    });
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let transactionPosts = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() === 'POST' &&
        /\/ledgers\/[^/]+\/transactions$/.test(url.pathname)
      ) {
        transactionPosts += 1;
        if (transactionPosts === 1) await firstWriteGate;
      }
      await route.continue();
    });

    try {
      await page.reload();
      await openDashboard(page);
      await submitFromCurrentPage(page, TWO_MEALS_TEXT);
      await expect(page.getByRole('button', { name: '確認草稿：早餐', exact: true })).toBeVisible();
      const firstWrite = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/ledgers\/[^/]+\/transactions$/.test(new URL(response.url()).pathname),
      );
      await page.getByRole('button', { name: '全部確認', exact: true }).click();
      await expect.poll(() => transactionPosts).toBe(1);

      await page.getByRole('button', { name: /的選單$|^帳號選單$/ }).click();
      await page.getByRole('button', { name: '登出', exact: true }).click();
      releaseFirstWrite?.();
      await (await firstWrite).finished();
      await page.waitForTimeout(100);
      expect(transactionPosts).toBe(1);
    } finally {
      releaseFirstWrite?.();
    }
  });

  test('SC-P31：成員降為檢視者後批次跳過其草稿，不改記到目前帳本', async ({
    signedInPage: page,
    userA,
    userB,
    request,
  }) => {
    const { personal } = await createPersonalAiCatalog(request, userA.token);
    const shared = await createLedger(request, userB.token, {
      name: '旅行基金',
      kind: 'SHARED',
    });
    await addMember(request, userB.token, shared.id, {
      email: userA.email,
      role: 'EDITOR',
    });
    await createCategory(request, userB.token, shared.id, {
      name: '機票',
      type: 'EXPENSE',
    });
    await createAccount(request, userA.token, { name: '信用卡' });

    await page.reload();
    await openTransactions(page);
    await submitFromCurrentPage(page, '旅行基金 機票 8000 刷卡');
    await expect(page.getByRole('button', { name: '編輯草稿：機票', exact: true })).toBeVisible();
    await submitFromCurrentPage(page, '早餐 60 現金');
    await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toBeVisible();

    await updateMemberRole(request, userB.token, shared.id, userA.id, 'VIEWER');
    await openDashboard(page);
    await openTransactions(page);

    const blockedConfirm = page.getByRole('button', { name: '確認草稿：機票', exact: true });
    await expect(blockedConfirm).toBeDisabled();
    const blockedRow = page.getByRole('listitem').filter({ has: blockedConfirm });
    await expect(blockedRow).toContainText('只能檢視');
    await expect(
      blockedRow.getByRole('button', { name: '編輯草稿：機票', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: '全部確認', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: '全部確認', exact: true }).click();
    await expect(page.getByRole('button', { name: '編輯草稿：機票', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toHaveCount(0);

    const personalTransactions = await listLedgerTransactions(request, userA.token, personal.id);
    expect(personalTransactions.items.some((transaction) => transaction.title === '早餐')).toBe(
      true,
    );
    expect(personalTransactions.items.some((transaction) => transaction.title === '機票')).toBe(
      false,
    );
    const sharedTransactions = await listLedgerTransactions(request, userB.token, shared.id);
    expect(sharedTransactions.items.some((transaction) => transaction.title === '機票')).toBe(
      false,
    );
  });
});

async function createPersonalAiCatalog(
  request: Parameters<typeof personalLedger>[0],
  token: string,
) {
  const personal = await personalLedger(request, token);
  const accounts = await listAccounts(request, token);
  const cash = accounts.find((account) => account.name === '現金' && !account.isTemporary);
  if (!cash) throw new Error('測試帳號缺少預設的「現金」帳戶。');
  const credit = await createAccount(request, token, { name: '信用卡' });
  const breakfastCategory = await createCategory(request, token, personal.id, {
    name: '早餐',
    type: 'EXPENSE',
  });
  await createCategory(request, token, personal.id, { name: '午餐', type: 'EXPENSE' });
  return { personal, cash, credit, breakfastCategory };
}

async function submitFromCurrentPage(page: import('@playwright/test').Page, text: string) {
  const toggle = page.getByRole('button', { name: 'AI 記帳', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('textbox', { name: '用一句話記帳' }).fill(text);
  await page.getByRole('button', { name: '送出', exact: true }).click();
}

async function toolbarHeight(toggle: import('@playwright/test').Locator): Promise<number> {
  return toggle.evaluate((element) => {
    let ancestor: HTMLElement | null = element.parentElement;
    while (ancestor !== null) {
      if (getComputedStyle(ancestor).position === 'sticky') {
        return ancestor.getBoundingClientRect().height;
      }
      ancestor = ancestor.parentElement;
    }
    throw new Error('找不到固定在頁面上方的工具列。');
  });
}

async function openDebtsView(page: import('@playwright/test').Page) {
  await openTransactions(page);
  const details = page
    .getByRole('group', { name: '檢視', exact: true })
    .getByRole('button', { name: '借還', exact: true });
  await details.click();
  await expect(details).toHaveAttribute('aria-pressed', 'true');
}
