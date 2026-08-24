import type { Page } from '@playwright/test';
import { addMember, createLedger, createTransaction, listAccounts, listCategories } from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';

/**
 * Slice 2 的六個情境（spec §7）。
 *
 * 這些測試走的是**使用者實際的動線**：點按鈕、填表單、看畫面。所以它們同時驗到
 * 三件事——前端邏輯、後端行為，以及兩者之間的那條線（CORS、序列化、位址）。
 *
 * 前置條件（帳號、要被刪的帳本裡先有別人的交易）則一律用 API 建立（D3、P4），
 * 因為那些流程在別條測試已經驗過，重跑只是拖慢。
 *
 * 元素一律用可及性選取器（`getByRole` / `getByLabel`）定位（P2）。
 * **不可以用 CSS class**——CSS Modules 的 class 名稱是編譯產生的，改個樣式就爛。
 */

/** 註冊時自動建立的個人帳本叫「{名字} 的帳本」（見 `auth.service.ts`）。 */
const PERSONAL_LEDGER_NAME = '甲 的帳本';
const TRIP_LEDGER_NAME = '出遊分帳';

/** 把畫面上的「$1,234」變回數字，好做加減比較。 */
function parseAmount(text: string | null): number {
  return Number((text ?? '').replace(/[$,\s]/g, ''));
}

/** 切換頁首的作用中帳本。只有一本帳本時切換器是一段文字，不是下拉。 */
async function switchLedger(page: Page, name: string): Promise<void> {
  await page.getByLabel('作用中帳本').selectOption({ label: name });
}

test('情境 1：不連動帳本的記帳表單沒有帳戶欄位', async ({ signedInPage: page }) => {
  await page.getByRole('link', { name: '帳本' }).click();
  await page.getByRole('button', { name: '建立帳本' }).click();

  const dialog = page.getByRole('dialog', { name: '建立帳本' });
  await dialog.getByLabel('名稱').fill(TRIP_LEDGER_NAME);
  await dialog.getByRole('radio', { name: '共享' }).check();
  await dialog.getByRole('radio', { name: '不連動' }).check();
  await dialog.getByRole('button', { name: '建立', exact: true }).click();

  await expect(page.getByRole('link', { name: TRIP_LEDGER_NAME })).toBeVisible();

  await page.getByRole('link', { name: '首頁' }).click();
  await switchLedger(page, TRIP_LEDGER_NAME);

  // SC-16：欄位必須整個不存在，不是停用——後端連「帶著空值」都會擋下。
  await expect(page.getByLabel('帳戶', { exact: true })).toHaveCount(0);
  await expect(page.getByText('這本帳本不影響你的帳戶餘額')).toBeVisible();

  await page.getByLabel('金額').fill('1200');
  await page.getByLabel('分類').selectOption({ label: '餐飲' });
  await page.getByRole('button', { name: '新增', exact: true }).click();

  // 限定在交易列表的那一列裡找。整頁搜尋「餐飲」會同時對到分類下拉的選項。
  const entry = page.getByRole('listitem').filter({ hasText: '-$1,200' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('餐飲');
});

test('情境 2：切回個人帳本後帳戶欄位回來，餘額跟著變動', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  // 前置：多一本不連動的帳本，才有東西可以切換。
  await createLedger(request, userA.token, {
    name: TRIP_LEDGER_NAME,
    kind: 'SHARED',
    tracksBalance: false,
  });
  await page.reload();

  await switchLedger(page, TRIP_LEDGER_NAME);
  await expect(page.getByLabel('帳戶', { exact: true })).toHaveCount(0);

  // SC-14：切回連動帳本，帳戶欄位就該回來。
  await switchLedger(page, PERSONAL_LEDGER_NAME);
  await expect(page.getByLabel('帳戶', { exact: true })).toBeVisible();

  const balance = page.getByLabel('現金餘額');
  const before = parseAmount(await balance.textContent());

  await page.getByLabel('金額').fill('1200');
  await page.getByLabel('分類').selectOption({ label: '餐飲' });
  await page.getByRole('button', { name: '新增', exact: true }).click();

  // SC-18：支出讓餘額減少相同的金額。用差額而非絕對值，才不會被預設值綁死。
  await expect(async () => {
    expect(parseAmount(await balance.textContent())).toBe(before - 1200);
  }).toPass();
});

test('情境 3：加入成員、變更角色，對方就看得到這本帳本', async ({
  signedInPage: page,
  userA,
  userB,
  request,
  openAs,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: TRIP_LEDGER_NAME,
    kind: 'SHARED',
  });
  await page.goto(`/ledgers/${ledger.id}`);

  await page.getByRole('button', { name: '加入成員' }).click();
  const dialog = page.getByRole('dialog', { name: '加入成員' });
  await dialog.getByLabel('email').fill(USER_B_EMAIL);
  await dialog.getByLabel('角色').selectOption({ label: '可編輯' });
  await dialog.getByRole('button', { name: '加入', exact: true }).click();

  await expect(page.getByText(USER_B_EMAIL)).toBeVisible();

  const roleSelect = page.getByLabel(`${userB.name}的角色`);
  await expect(roleSelect).toHaveValue('EDITOR');
  await roleSelect.selectOption({ label: '唯讀' });
  await expect(roleSelect).toHaveValue('VIEWER');

  // SC-8：換一個瀏覽器 context（等同另一台電腦），B 現在看得到這本帳本。
  const pageB = await openAs(userB);
  await pageB.getByRole('link', { name: '帳本' }).click();
  await expect(pageB.getByRole('link', { name: TRIP_LEDGER_NAME })).toBeVisible();
});

test('情境 4：非 owner 看不到成員管理的操作', async ({ userA, userB, request, openAs }) => {
  const ledger = await createLedger(request, userA.token, {
    name: TRIP_LEDGER_NAME,
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });

  const pageB = await openAs(userB);
  await pageB.goto(`/ledgers/${ledger.id}`);

  // 先確認這一頁真的載出來了，否則下面「什麼都看不到」會是假通過。
  await expect(pageB.getByRole('heading', { name: TRIP_LEDGER_NAME })).toBeVisible();
  await expect(pageB.getByText(userA.email)).toBeVisible();

  await expect(pageB.getByRole('button', { name: '加入成員' })).toHaveCount(0);
  await expect(pageB.getByLabel(`移除${userA.name}`)).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: '刪除帳本' })).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: '封存帳本' })).toHaveCount(0);

  // ⚠️ 這一條驗的是**體驗**，不是授權。真正的防線在後端的 @RequireLedgerRole
  // （Slice 2 的 D7）；按鈕畫不畫從來不是安全機制。
});

test('情境 5：封存後帳本從切換器消失，勾選「顯示已封存」才看得到', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: TRIP_LEDGER_NAME,
    kind: 'SHARED',
  });
  // 再多一本，這樣封存之後仍有兩本未封存的帳本，切換器還是下拉。
  await createLedger(request, userA.token, { name: '社團公款', kind: 'SHARED' });

  await page.goto(`/ledgers/${ledger.id}`);
  await page.getByRole('button', { name: '封存帳本' }).click();

  const dialog = page.getByRole('dialog', { name: '封存帳本' });
  await dialog.getByLabel(`請輸入「${TRIP_LEDGER_NAME}」以確認`).fill(TRIP_LEDGER_NAME);
  await dialog.getByRole('button', { name: '封存', exact: true }).click();

  // SC-17：封存的帳本不再出現在切換器——切過去只會讓每一次記帳都是 409。
  await expect(page.getByLabel('作用中帳本')).not.toContainText(TRIP_LEDGER_NAME);

  await page.getByRole('link', { name: '帳本' }).click();
  await expect(page.getByRole('link', { name: TRIP_LEDGER_NAME })).toHaveCount(0);

  await page.getByLabel('顯示已封存的帳本').check();
  // 限定在那本帳本的那一列裡找，才問得出「已封存的標記是掛在它身上」。
  const row = page.getByRole('listitem').filter({ hasText: TRIP_LEDGER_NAME });
  await expect(row).toBeVisible();
  await expect(row).toContainText('已封存');
});

test('情境 6：刪除帳本要打對名稱，而且有別人的交易時會被擋下', async ({
  signedInPage: page,
  userA,
  userB,
  request,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: TRIP_LEDGER_NAME,
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });

  // P4：這筆交易是前置條件，用 API 建立。沒有它，後端不會回 409，那條分支根本走不到。
  const [accountB] = await listAccounts(request, userB.token);
  const categories = await listCategories(request, userB.token, ledger.id);
  const meal = categories.find(
    (category) => category.name === '餐飲' && category.type === 'EXPENSE',
  );
  await createTransaction(request, userB.token, ledger.id, {
    type: 'EXPENSE',
    amount: 300,
    date: new Date().toISOString(),
    categoryId: meal!.id,
    accountId: accountB!.id,
  });

  await page.goto(`/ledgers/${ledger.id}`);
  await page.getByRole('button', { name: '刪除帳本' }).click();

  const dialog = page.getByRole('dialog', { name: '刪除帳本' });
  const confirmButton = dialog.getByRole('button', { name: '刪除', exact: true });
  const confirmField = dialog.getByLabel(`請輸入「${TRIP_LEDGER_NAME}」以確認`);

  // 第一道關卡：名稱打錯就按不下去。
  await confirmField.fill('出遊分帳本');
  await expect(confirmButton).toBeDisabled();

  // 第二道關卡：名稱打對了，後端仍以 409 擋下，並引導改用封存。
  await confirmField.fill(TRIP_LEDGER_NAME);
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(dialog.getByText('這本帳本有其他成員記的交易，不能刪除')).toBeVisible();
  await expect(dialog.getByText('改用「封存帳本」')).toBeVisible();
});
