import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  createCounterparty,
  createDebtEntry,
  linkByEmail,
  listAccounts,
  mergeCounterparties,
  TEST_PASSWORD,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import { expectNoHorizontalOverflow, openDashboard } from './ui';

/**
 * 3b-2 往來帳連動的端對端流程（`docs/specs/phase-3b2-web.md` §6 與修訂 1 §10）。
 *
 * 元件測試把 API 整個 mock 掉，證不出「兩個人真的接起來了」：A 邀請、B 接受後雙方真的多了
 * 已連動的對象、合併真的把舊紀錄搬過去、B 的帳戶真的跟著變。這裡用兩個獨立的瀏覽器 context
 * 同時操作 A（甲）與 B（乙），走真的後端。
 *
 * 前置條件（加人、連動）凡是別條測試已經走過畫面的，一律用 API 建立。每條結束前檢查頁面文字
 * 沒有「好友」（SC-W47），新彈窗都檢查不會出現橫向捲軸（SC-W59）。
 */

async function cash(request: APIRequestContext, token: string): Promise<number> {
  const accounts = await listAccounts(request, token);
  return accounts.find((account) => account.name === '現金')!.balance;
}

function ledgerPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: '借還往來' });
}

function pendingCard(page: Page): Locator {
  return page.getByRole('region', { name: /待確認/ });
}

/** 待確認卡片裡提到某段文字的那一列。 */
function pendingRow(page: Page, hasText: string | RegExp): Locator {
  return pendingCard(page).getByRole('listitem').filter({ hasText });
}

/** 從側欄走到對象頁。 */
async function openCounterparties(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '對象' })
    .click();
  await page.getByRole('heading', { level: 2, name: '對象' }).waitFor();
}

function group(page: Page, name: '已連動' | '未連動'): Locator {
  return page.getByRole('region', { name: new RegExp(`^${name}`) });
}

/** 在對象頁點一個人，打開他的往來帳。 */
async function openPerson(page: Page, name: string | RegExp): Promise<Locator> {
  await openCounterparties(page);
  await page.getByRole('main').getByRole('button', { name }).first().click();
  const panel = ledgerPanel(page);
  await panel.waitFor();
  return panel;
}

/** 回答「之前有用別的名字記過他嗎？」。`source` 為 null 表示「沒有」。 */
async function answerMergePrompt(scope: Locator, source: string | null): Promise<void> {
  if (source === null) {
    await scope.getByRole('radio', { name: '沒有' }).check();
  } else {
    await scope.getByRole('radio', { name: '有：', exact: true }).check();
    await scope.getByRole('combobox', { name: '未連動的人' }).selectOption({ label: source });
  }
  await scope.getByRole('button', { name: '確定' }).click();
}

async function expectNoFriendWord(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('好友');
}

test('連動主線：對象頁邀請與取消、接受後詢問並合併、同步一筆、暱稱、解除', async ({
  signedInPage: pageA,
  openAs,
  userB,
  request,
}) => {
  test.setTimeout(150_000);
  // B 早就用「阿甲」記過 A；A 也有一個「阿乙」。
  const bOld = await createCounterparty(request, userB.token, '阿甲');
  await createDebtEntry(request, userB.token, {
    counterparty: { id: bOld.id },
    kind: 'BORROW',
    amount: 30,
    date: new Date().toISOString(),
    record: null,
  });
  const pageB = await openAs(userB);

  // SC-W51：對象頁；SC-W36 的「＋ 新增」。
  await openCounterparties(pageA);
  await pageA.getByRole('button', { name: '＋ 新增' }).click();
  const addDialog = pageA.getByRole('dialog', { name: '新增一個人' });
  await addDialog.getByLabel('名字').fill('阿乙');
  await expectNoHorizontalOverflow(addDialog);
  await addDialog.getByRole('button', { name: '新增' }).click();
  await expect(group(pageA, '未連動').getByRole('button', { name: '阿乙' })).toBeVisible();
  await expect(pageA.getByRole('main')).not.toContainText('$');

  // SC-W52：邀請、邀請中、取消、再邀請。
  await pageA.getByRole('button', { name: '邀請連動' }).click();
  let invite = pageA.getByRole('dialog', { name: '邀請連動' });
  await expectNoHorizontalOverflow(invite);
  await invite.getByLabel('對方的 email').fill(USER_B_EMAIL);
  await invite.getByRole('button', { name: '傳送邀請' }).click();
  const inviting = pageA.getByRole('region', { name: '邀請中' });
  await expect(inviting.getByText(USER_B_EMAIL)).toBeVisible();
  await inviting.getByRole('button', { name: '取消邀請' }).click();
  await expect(inviting).toHaveCount(0);
  await pageA.getByRole('button', { name: '邀請連動' }).click();
  invite = pageA.getByRole('dialog', { name: '邀請連動' });
  await invite.getByLabel('對方的 email').fill(USER_B_EMAIL);
  await invite.getByRole('button', { name: '傳送邀請' }).click();
  await expect(inviting.getByText(USER_B_EMAIL)).toBeVisible();

  // SC-W53：B 在總覽按接受（不選人）→ 詢問 → 併入「阿甲」。
  await pageB.reload();
  await pendingRow(pageB, '甲 邀請你連動往來帳').getByRole('button', { name: '接受' }).click();
  const prompt = pageB.getByRole('dialog', { name: '已和 甲 連動' });
  await expectNoHorizontalOverflow(prompt);
  await answerMergePrompt(prompt, '阿甲');
  await expect(prompt).toHaveCount(0);
  await openCounterparties(pageB);
  await expect(group(pageB, '已連動')).toContainText('甲（阿甲）');
  await expect(group(pageB, '未連動').getByRole('button', { name: '阿甲' })).toHaveCount(0);

  // SC-W54：A 的總覽出現詢問；「稍後」後仍在；再回答「有：阿乙」。
  await pageA.reload();
  await openDashboard(pageA);
  const askRow = pendingRow(pageA, '乙 已接受連動');
  await askRow.getByRole('button', { name: '回答' }).click();
  await pendingCard(pageA).getByRole('button', { name: '稍後' }).click();
  await expect(askRow).toBeVisible();
  await askRow.getByRole('button', { name: '回答' }).click();
  await answerMergePrompt(pendingCard(pageA), '阿乙');
  await expect(askRow).toHaveCount(0);
  await openCounterparties(pageA);
  await expect(group(pageA, '已連動')).toContainText('乙（阿乙）');

  // SC-W40（修訂後）：A 記借出 120 → B 的待確認用 B 取的暱稱寫「阿甲」→ 接受並選帳戶。
  const bCashBefore = await cash(request, userB.token);
  const panelA = await openPerson(pageA, /乙/);
  await panelA.getByRole('button', { name: '記一筆' }).click();
  const form = pageA.getByRole('group', { name: '新增一筆交易' });
  await form.getByRole('button', { name: '借出' }).click();
  await form.getByLabel('金額').fill('120');
  await form.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await form.getByRole('button', { name: '新增' }).click();

  await pageB.reload();
  await openDashboard(pageB);
  await pendingRow(pageB, '阿甲 記了一筆：你向他借入 $120')
    .getByRole('button', { name: '接受' })
    .click();
  await pendingCard(pageB)
    .getByRole('combobox', { name: '借到的錢進哪個帳戶' })
    .selectOption({ label: '現金' });
  await pendingCard(pageB).getByRole('button', { name: '接受', exact: true }).click();
  await expect.poll(() => cash(request, userB.token)).toBe(bCashBefore + 120);

  // SC-W56：B 清掉暱稱 → 顯示回帳號名稱；再設回來。
  const panelB = await openPerson(pageB, /甲/);
  await expect(panelB.getByText('已同步')).toBeVisible();
  await panelB.getByRole('button', { name: '設定暱稱' }).click();
  const nickname = pageB.getByRole('dialog', { name: '設定暱稱' });
  await expectNoHorizontalOverflow(nickname);
  await nickname.getByLabel('暱稱').fill('');
  await nickname.getByRole('button', { name: '儲存' }).click();
  await expect(group(pageB, '已連動').getByRole('button', { name: /甲/ })).not.toContainText('（');

  // SC-W45：A 解除連動 → 名字與紀錄保留。
  const panelAUnlink = await openPerson(pageA, /乙/);
  await panelAUnlink.getByRole('button', { name: '解除連動' }).click();
  const unlink = pageA.getByRole('dialog', { name: '解除和阿乙的連動' });
  await expectNoHorizontalOverflow(unlink);
  await unlink.getByRole('button', { name: '解除連動' }).click();
  await expect(group(pageA, '未連動').getByRole('button', { name: '阿乙' })).toBeVisible();
  await expect(group(pageA, '已連動').getByRole('button')).toHaveCount(0);

  await expectNoFriendWord(pageA);
  await expectNoFriendWord(pageB);
});

test('邀請連結：未登入開啟、頁內登入、接受不選人、打開對象頁', async ({
  signedInPage: pageA,
  userB,
  browser,
}) => {
  test.setTimeout(90_000);
  // fixture 是用到才建立；列出來 B 的帳號才會存在。
  void userB;
  await openCounterparties(pageA);
  await pageA.getByRole('button', { name: '邀請連動' }).click();
  const invite = pageA.getByRole('dialog', { name: '邀請連動' });
  await invite.getByRole('button', { name: '產生連結' }).click();
  const linkField = invite.getByRole('textbox', { name: '邀請連結' });
  await expect(linkField).toHaveValue(/\/invite#.+/);
  await expectNoHorizontalOverflow(invite);
  const url = new URL(await linkField.inputValue());

  // SC-W57：B 沒登入就開連結；B 沒有任何未連動的人，所以接受後不跳詢問。
  const context = await browser.newContext();
  const pageB = await context.newPage();
  await pageB.goto(`${url.pathname}${url.hash}`);
  await pageB.getByRole('button', { name: '登入' }).click();
  const loginDialog = pageB.getByRole('dialog');
  await loginDialog.getByLabel(/email/i).fill(USER_B_EMAIL);
  await loginDialog.getByLabel('密碼').fill(TEST_PASSWORD);
  await loginDialog.getByRole('button', { name: '登入' }).click();

  await expect(pageB.getByRole('heading', { name: '甲 邀請你連動往來帳' })).toBeVisible();
  await pageB.getByRole('button', { name: '接受' }).click();
  await expect(pageB).toHaveURL(/\/counterparties$/);
  expect(new URL(pageB.url()).hash).toBe('');
  await expect(ledgerPanel(pageB).getByRole('heading', { name: '甲' })).toBeVisible();

  await pageB.goto('/invite#not-a-real-token');
  await expect(pageB.getByText('連結無效或已過期')).toBeVisible();

  await expectNoFriendWord(pageB);
  await context.close();
});

test('錯過詢問：之後從往來帳「合併之前的紀錄」補做', async ({
  signedInPage: pageA,
  userA,
  userB,
  request,
}) => {
  test.setTimeout(90_000);
  const old = await createCounterparty(request, userA.token, '舊乙');
  await createDebtEntry(request, userA.token, {
    counterparty: { id: old.id },
    kind: 'LEND',
    amount: 50,
    date: new Date().toISOString(),
    record: null,
  });
  await linkByEmail(request, userA, userB);

  // SC-W55：從往來帳補做合併。
  const panel = await openPerson(pageA, /乙/);
  await panel.getByRole('button', { name: '合併之前的紀錄' }).click();
  const merge = pageA.getByRole('dialog', { name: '合併之前的紀錄' });
  await expectNoHorizontalOverflow(merge);
  await merge.getByRole('combobox', { name: '併入' }).selectOption({ label: '舊乙' });
  await merge.getByRole('button', { name: '合併' }).click();
  await expect(panel.getByRole('heading', { name: '舊乙' })).toBeVisible();
  await expect(panel.getByText('舊乙欠你 $50')).toBeVisible();
  await expect(group(pageA, '已連動')).toContainText('乙（舊乙）');
  await expect(group(pageA, '未連動').getByRole('button', { name: '舊乙' })).toHaveCount(0);

  // 合併完成，待確認不再詢問。
  await openDashboard(pageA);
  await expect(pendingRow(pageA, '已接受連動')).toHaveCount(0);
});

test('接受時帳上對不起來：兩清時收到還款，改成拒絕', async ({
  signedInPage: pageA,
  openAs,
  userA,
  userB,
  request,
}) => {
  test.setTimeout(90_000);
  // A 在連動前就記了「小明欠我 50」，B 那邊沒有這筆（決策 59）。
  const xiaoming = await createCounterparty(request, userA.token, '小明');
  await createDebtEntry(request, userA.token, {
    counterparty: { id: xiaoming.id },
    kind: 'LEND',
    amount: 50,
    date: new Date().toISOString(),
    record: null,
  });
  const { inviterSideId } = await linkByEmail(request, userA, userB);
  // A 把舊的「小明」併進新的已連動對象，這樣 A 帳上乙欠 50、B 帳上兩清。
  await mergeCounterparties(request, userA.token, inviterSideId, xiaoming.id);
  await createDebtEntry(request, userA.token, {
    counterparty: { id: inviterSideId },
    kind: 'REPAYMENT',
    amount: 50,
    date: new Date().toISOString(),
    record: null,
  });

  const pageB = await openAs(userB);
  await pendingRow(pageB, '記了一筆：你還他 $50').getByRole('button', { name: '接受' }).click();
  await pendingCard(pageB).getByLabel('不記入帳本（只記往來）').check();
  await pendingCard(pageB).getByRole('button', { name: '接受', exact: true }).click();
  await expect(pendingCard(pageB).getByText('你帳上目前兩清')).toBeVisible();
  await pendingCard(pageB).getByRole('button', { name: '改成拒絕' }).click();
  await expect(pendingRow(pageB, '你還他 $50')).toHaveCount(0);

  const panelA = await openPerson(pageA, /乙/);
  await expect(panelA.getByText('對方未接受')).toBeVisible();
});
