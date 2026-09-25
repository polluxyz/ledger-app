import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  createCounterparty,
  createDebtEntry,
  linkByEmail,
  listAccounts,
  TEST_PASSWORD,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  expectNoHorizontalOverflow,
  newTransactionForm,
  openDashboard,
  openTransactions,
} from './ui';

/**
 * 3b-2 往來帳連動的端對端流程（`docs/specs/phase-3b2-web.md` §6）。
 *
 * 元件測試把 API 整個 mock 掉，證不出「兩個人真的接起來了」：A 記的一筆，B 接受後
 * B 的帳戶真的變、雙方的同步標籤真的由後端算出。這裡用兩個獨立的瀏覽器 context 同時
 * 操作 A（甲）與 B（乙），走真的後端。
 *
 * 前置條件（加人、連動）凡是別條測試已經走過畫面的，一律用 API 建立。
 * 每一條結束前檢查頁面文字沒有「好友」（SC-W47）。
 */

async function cash(request: APIRequestContext, token: string): Promise<number> {
  const accounts = await listAccounts(request, token);
  return accounts.find((account) => account.name === '現金')!.balance;
}

function ledgerPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: '借還往來' });
}

function pendingCard(page: Page): Locator {
  return page.getByRole('region', { name: '待確認' });
}

/** 待確認卡片裡提到某段文字的那一列。 */
function pendingRow(page: Page, hasText: string | RegExp): Locator {
  return pendingCard(page).getByRole('listitem').filter({ hasText });
}

/** 到借還檢視，點某個人打開他的往來帳。 */
async function openLedgerOf(page: Page, name: string): Promise<Locator> {
  await openTransactions(page);
  await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: '借還' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  const panel = ledgerPanel(page);
  await expect(panel.getByRole('heading', { name })).toBeVisible();
  return panel;
}

/** 某一筆往來紀錄（以種類與金額辨認）。 */
function entryRow(panel: Locator, kind: string, delta: string): Locator {
  return panel.getByRole('listitem').filter({ hasText: kind }).filter({ hasText: delta });
}

async function expectNoFriendWord(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('好友');
}

test('連動主線：邀請與取消、接受、同步一筆、拒絕、修改、解除', async ({
  signedInPage: pageA,
  openAs,
  userA,
  userB,
  request,
}) => {
  // 兩個人來回操作十幾步，預設的 30 秒不夠。
  test.setTimeout(120_000);
  const pageB = await openAs(userB);

  // SC-W36：不記帳先加人。
  await openTransactions(pageA);
  await pageA.getByRole('group', { name: '檢視' }).getByRole('button', { name: '借還' }).click();
  await pageA.getByRole('button', { name: '＋ 新增' }).click();
  const addDialog = pageA.getByRole('dialog', { name: '新增一個人' });
  await addDialog.getByLabel('名字').fill('小明');
  await expectNoHorizontalOverflow(addDialog);
  await addDialog.getByRole('button', { name: '新增' }).click();
  const panelA = ledgerPanel(pageA);
  await expect(panelA.getByRole('heading', { name: '小明' })).toBeVisible();
  await expect(panelA.getByText('兩清', { exact: true })).toBeVisible();

  // SC-W37：用 email 邀請 → 看得到「已邀請」→ 取消 → 按鈕回來。
  await panelA.getByRole('button', { name: '邀請連動' }).click();
  let inviteDialog = pageA.getByRole('dialog', { name: '邀請連動：小明' });
  await expectNoHorizontalOverflow(inviteDialog);
  await inviteDialog.getByLabel('對方註冊用的 email').fill(USER_B_EMAIL);
  await inviteDialog.getByRole('button', { name: '送出' }).click();
  await expect(panelA.getByText(`已邀請 ${USER_B_EMAIL}，等對方接受`)).toBeVisible();
  await expect(panelA.getByRole('button', { name: '邀請連動' })).toHaveCount(0);
  await panelA.getByRole('button', { name: '取消邀請' }).click();
  await expect(panelA.getByRole('button', { name: '邀請連動' })).toBeVisible();

  // SC-W38：再邀請一次，B 在總覽接受，保留預設的新名字「甲」。
  await panelA.getByRole('button', { name: '邀請連動' }).click();
  inviteDialog = pageA.getByRole('dialog', { name: '邀請連動：小明' });
  await inviteDialog.getByLabel('對方註冊用的 email').fill(USER_B_EMAIL);
  await inviteDialog.getByRole('button', { name: '送出' }).click();
  await expect(panelA.getByText(`已邀請 ${USER_B_EMAIL}，等對方接受`)).toBeVisible();

  await pageB.reload();
  const inviteRow = pendingRow(pageB, '甲 邀請你連動往來帳');
  await inviteRow.getByRole('button', { name: '接受' }).click();
  await expect(
    pendingCard(pageB).getByRole('combobox', { name: '對方在你的往來帳裡是誰？' }),
  ).toHaveValue('甲');
  await pendingCard(pageB).getByRole('button', { name: '接受並連動' }).click();
  await pendingCard(pageB).getByRole('button', { name: '查看往來帳' }).click();
  const panelB = ledgerPanel(pageB);
  await expect(panelB.getByRole('heading', { name: '甲' })).toBeVisible();
  await expect(panelB.getByText('已和 甲 連動')).toBeVisible();

  await pageA.reload();
  const linkedPanelA = await openLedgerOf(pageA, '小明');
  await expect(linkedPanelA.getByText('已和 乙 連動')).toBeVisible();
  await expect(linkedPanelA.getByRole('button', { name: '刪除對象' })).toHaveCount(0);

  // SC-W40：A 記借出 120 → 等對方確認 → B 接受、選帳戶 → 雙方已同步、B 的現金 +120。
  const bCashBefore = await cash(request, userB.token);
  await linkedPanelA.getByRole('button', { name: '記一筆' }).click();
  const form = newTransactionForm(pageA);
  await form.getByRole('button', { name: '借出' }).click();
  await form.getByLabel('金額').fill('120');
  await form.getByRole('combobox', { name: /帳戶/ }).selectOption({ label: '現金' });
  await expect(form.getByText('送出後會請 乙 確認')).toBeVisible();
  await form.getByRole('button', { name: '新增' }).click();

  const panelAfterLend = await openLedgerOf(pageA, '小明');
  await expect(entryRow(panelAfterLend, '借出', '120').getByText('等對方確認')).toBeVisible();

  await openDashboard(pageB);
  const lendRow = pendingRow(pageB, '甲 記了一筆：你向他借入 $120');
  await lendRow.getByRole('button', { name: '接受' }).click();
  const accept = pendingCard(pageB).getByRole('button', { name: '接受', exact: true });
  await expect(accept).toBeDisabled();
  await pendingCard(pageB)
    .getByRole('combobox', { name: '借到的錢進哪個帳戶' })
    .selectOption({ label: '現金' });
  await accept.click();
  await expect.poll(() => cash(request, userB.token)).toBe(bCashBefore + 120);

  const panelBSynced = await openLedgerOf(pageB, '甲');
  await expect(entryRow(panelBSynced, '借入', '120').getByText('已同步')).toBeVisible();
  await pageA.reload();
  const panelASynced = await openLedgerOf(pageA, '小明');
  await expect(entryRow(panelASynced, '借出', '120').getByText('已同步')).toBeVisible();

  // SC-W41：A 再借出 100（不記入帳本），B 拒絕 → A 看到「對方未接受」，B 的往來帳不變。
  await createDebtEntry(request, userA.token, {
    counterparty: { name: '小明' },
    kind: 'LEND',
    amount: 100,
    date: new Date().toISOString(),
    record: null,
  });
  await openDashboard(pageB);
  await pendingRow(pageB, '你向他借入 $100').getByRole('button', { name: '拒絕' }).click();
  await expect(pendingCard(pageB)).toHaveCount(0);
  await pageA.reload();
  const panelADeclined = await openLedgerOf(pageA, '小明');
  await expect(entryRow(panelADeclined, '借出', '100').getByText('對方未接受')).toBeVisible();

  // SC-W43：A 把已同步的 120 改成 150 → 視窗有同步說明；B 的卡片寫出 $120 → $150，接受後變 150。
  await entryRow(panelADeclined, '借出', '120').getByRole('button', { name: '修改' }).click();
  const editDialog = pageA.getByRole('dialog', { name: '修改往來紀錄' });
  await expect(editDialog.getByText(/這筆已和乙同步/)).toBeVisible();
  await expectNoHorizontalOverflow(editDialog);
  await editDialog.getByLabel('金額').fill('150');
  await editDialog.getByRole('button', { name: /存檔|儲存/ }).click();
  // 沒同步的那筆（被拒絕的 100）修改時沒有同步說明。
  await entryRow(panelADeclined, '借出', '100').getByRole('button', { name: '修改' }).click();
  await expect(
    pageA.getByRole('dialog', { name: '修改往來紀錄' }).getByText(/這筆已和乙同步/),
  ).toHaveCount(0);
  await pageA
    .getByRole('dialog', { name: '修改往來紀錄' })
    .getByRole('button', { name: '取消' })
    .click();

  // B 一直停在總覽：再點一次首頁不會重新取資料（實際使用靠切回分頁時重新取），這裡重新整理。
  await pageB.reload();
  const amendRow = pendingRow(pageB, /\$120 → \$150/);
  await amendRow.getByRole('button', { name: '接受' }).click();
  await expect(pendingCard(pageB)).toHaveCount(0);
  await expect.poll(() => cash(request, userB.token)).toBe(bCashBefore + 150);

  // SC-W45：A 解除連動 → 名字與紀錄保留、標籤消失、按鈕回到「邀請連動」；B 那邊同樣。
  await pageA.reload();
  const panelAUnlink = await openLedgerOf(pageA, '小明');
  await panelAUnlink.getByRole('button', { name: '解除連動' }).click();
  const unlinkDialog = pageA.getByRole('dialog', { name: '解除和乙的連動' });
  await expect(unlinkDialog.getByText('解除後，「小明」和所有往來紀錄都會保留')).toBeVisible();
  await expectNoHorizontalOverflow(unlinkDialog);
  await unlinkDialog.getByRole('button', { name: '解除連動' }).click();
  await expect(panelAUnlink.getByRole('button', { name: '邀請連動' })).toBeVisible();
  await expect(panelAUnlink.getByText('已和 乙 連動')).toHaveCount(0);
  await expect(panelAUnlink.getByText('已同步')).toHaveCount(0);
  await expect(entryRow(panelAUnlink, '借出', '150')).toBeVisible();

  await pageB.reload();
  const panelBUnlinked = await openLedgerOf(pageB, '甲');
  await expect(panelBUnlinked.getByRole('button', { name: '邀請連動' })).toBeVisible();
  await expect(entryRow(panelBUnlinked, '借入', '150')).toBeVisible();

  await expectNoFriendWord(pageA);
  await expectNoFriendWord(pageB);
});

test('邀請連結：未登入開啟、頁內登入、改選既有的人、接受後打開往來帳', async ({
  signedInPage: pageA,
  browser,
  userA,
  userB,
  request,
}) => {
  test.setTimeout(90_000);
  await createCounterparty(request, userA.token, '小明');
  // B 早就用「阿甲」記過 A，接受時改選這個人（決策 58）。
  await createCounterparty(request, userB.token, '阿甲');

  const panelA = await openLedgerOf(pageA, '小明');
  await panelA.getByRole('button', { name: '邀請連動' }).click();
  const inviteDialog = pageA.getByRole('dialog', { name: '邀請連動：小明' });
  await inviteDialog.getByRole('button', { name: '產生邀請連結' }).click();
  const linkField = inviteDialog.getByRole('textbox', { name: '邀請連結' });
  await expect(linkField).toHaveValue(/\/invite#.+/);
  // 產生連結後最寬：長網址與「複製」按鈕並排。
  await expectNoHorizontalOverflow(inviteDialog);
  const url = new URL(await linkField.inputValue());

  // SC-W39：B 沒登入就開連結。token 在 # 之後，不送進伺服器。
  const context = await browser.newContext();
  const pageB = await context.newPage();
  await pageB.goto(`${url.pathname}${url.hash}`);
  await expect(pageB.getByText('登入後查看邀請。')).toBeVisible();
  await pageB.getByRole('button', { name: '登入' }).click();
  const loginDialog = pageB.getByRole('dialog');
  await loginDialog.getByLabel(/email/i).fill(USER_B_EMAIL);
  await loginDialog.getByLabel('密碼').fill(TEST_PASSWORD);
  await loginDialog.getByRole('button', { name: '登入' }).click();

  await expect(pageB.getByRole('heading', { name: '甲 邀請你連動往來帳' })).toBeVisible();
  const picker = pageB.getByRole('combobox', { name: '對方在你的往來帳裡是誰？' });
  await expect(picker).toHaveValue('甲');
  await picker.fill('阿');
  await pageB.getByRole('option', { name: /阿甲/ }).click();
  await pageB.getByRole('button', { name: '接受並連動' }).click();

  await expect(pageB).toHaveURL(/\/transactions\?view=debts$/);
  expect(new URL(pageB.url()).hash).toBe('');
  const panelB = ledgerPanel(pageB);
  await expect(panelB.getByRole('heading', { name: '阿甲' })).toBeVisible();
  await expect(panelB.getByText('已和 甲 連動')).toBeVisible();

  // 無效（格式不對）的 token：說明怎麼補救，不秀出驗證訊息。
  await pageB.goto('/invite#not-a-real-token');
  await expect(pageB.getByText('這個連結無效或已過期，請對方重新產生。')).toBeVisible();

  await expectNoFriendWord(pageB);
  await context.close();
});

test('接受時帳上對不起來：兩清時收到還款，改成拒絕', async ({
  signedInPage: pageA,
  openAs,
  userA,
  userB,
  request,
}) => {
  // A 在連動前就記了「小明欠我 50」，B 那邊沒有這筆（決策 59）。
  const xiaoming = await createCounterparty(request, userA.token, '小明');
  await createDebtEntry(request, userA.token, {
    counterparty: { id: xiaoming.id },
    kind: 'LEND',
    amount: 50,
    date: new Date().toISOString(),
    record: null,
  });
  await linkByEmail(request, userA, xiaoming.id, userB, '甲');
  // 連動後 A 記「小明還我 50」→ B 收到「你還他 $50」，但 B 帳上和甲兩清。
  await createDebtEntry(request, userA.token, {
    counterparty: { id: xiaoming.id },
    kind: 'REPAYMENT',
    amount: 50,
    date: new Date().toISOString(),
    record: null,
  });

  const pageB = await openAs(userB);
  const row = pendingRow(pageB, '甲 記了一筆：你還他 $50');
  await row.getByRole('button', { name: '接受' }).click();
  await pendingCard(pageB).getByLabel('不記入帳本（只記往來）').check();
  await pendingCard(pageB).getByRole('button', { name: '接受', exact: true }).click();
  await expect(pendingCard(pageB).getByText(/目前兩清，這筆還款記不進去/)).toBeVisible();
  await pendingCard(pageB).getByRole('button', { name: '改成拒絕' }).click();
  await expect(pendingCard(pageB)).toHaveCount(0);

  await pageA.reload();
  const panelA = await openLedgerOf(pageA, '小明');
  await expect(panelA.getByText('對方未接受')).toBeVisible();
});
