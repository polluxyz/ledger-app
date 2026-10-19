import { formatMoney, type CreateSettlementRequest, type LedgerDetail } from '@ledger/shared';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  addMember,
  createAccount,
  createLedger,
  createTransaction,
  listAccounts,
  listCategories,
  listLedgerPeople,
  listLedgers,
  personalLedger,
  registerUser,
  updateMemberRole,
  type TestUser,
} from './api';
import { API_BASE_URL } from './env';
import { expect, test } from './fixtures';
import { debtRow, expandDebtRow, openDebtsTab, openTransactions } from './ui';

const SOURCE_LEDGER_NAME = '花蓮三日';
const TARGET_LEDGER_NAME = '日常';
const LODGING_CENTS = 300_000;
const DINNER_CENTS = 150_000;
const SETTLEMENT_CENTS = 100_000;

interface TripScenario {
  owner: TestUser;
  ming: TestUser;
  hua: TestUser;
  ledger: { id: string; name: string };
  daily: { id: string; name: string };
  cash: { id: string; initialBalance: number };
  creditCard: { id: string; initialBalance: number };
  accountBalancesBefore: Array<{ id: string; balance: number }>;
}

async function signInAs(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript(
    ([key, token]) => window.localStorage.setItem(key!, token!),
    ['ledger.accessToken', user.token],
  );
  await page.goto('/');
}

async function renameLedger(
  request: APIRequestContext,
  user: TestUser,
  ledgerId: string,
  name: string,
): Promise<void> {
  const response = await request.patch(`${API_BASE_URL}/ledgers/${ledgerId}`, {
    headers: { Authorization: `Bearer ${user.token}` },
    data: { name },
  });
  if (!response.ok()) {
    throw new Error(`把帳本改名為「${name}」失敗：${response.status()} ${await response.text()}`);
  }
}

async function createTripScenario(request: APIRequestContext, page: Page): Promise<TripScenario> {
  const owner = await registerUser(request, 'owner@example.com', '我');
  const ming = await registerUser(request, 'ming@example.com', '小明');
  const hua = await registerUser(request, 'hua@example.com', '小華');

  const daily = await personalLedger(request, owner.token);
  await renameLedger(request, owner, daily.id, TARGET_LEDGER_NAME);
  const ledger = await createLedger(request, owner.token, {
    name: SOURCE_LEDGER_NAME,
    kind: 'SHARED',
  });
  await addMember(request, owner.token, ledger.id, { email: ming.email, role: 'EDITOR' });
  await addMember(request, owner.token, ledger.id, { email: hua.email, role: 'EDITOR' });
  // 離開帳本的流程不可由最後一位擁有者執行，讓小明也成為擁有者，保持這條主線可退出。
  await updateMemberRole(request, owner.token, ledger.id, ming.id, 'OWNER');

  const people = await listLedgerPeople(request, owner.token, ledger.id);
  function personId(user: TestUser): string {
    const person = people.find((candidate) => candidate.userId === user.id);
    if (!person) {
      throw new Error(`帳本裡找不到 ${user.name} 的 LedgerPerson。`);
    }
    return person.id;
  }

  const [categories, accounts] = await Promise.all([
    listCategories(request, owner.token, ledger.id),
    listAccounts(request, owner.token),
  ]);
  const expenseCategory = categories.find((category) => category.type === 'EXPENSE');
  const cash = accounts.find((account) => account.name === '現金' && !account.isTemporary);
  if (!expenseCategory || !cash) {
    throw new Error('建立花蓮三日前置資料時找不到支出分類或真正的現金帳戶。');
  }
  const creditCard = await createAccount(request, owner.token, {
    name: '信用卡',
    initialBalance: 0,
  });

  const date = new Date().toISOString();
  const shares = [owner, ming, hua].map((user) => ({ personId: personId(user) }));
  await createTransaction(request, owner.token, ledger.id, {
    type: 'EXPENSE',
    amount: LODGING_CENTS,
    date,
    title: '住宿',
    categoryId: expenseCategory.id,
    accountId: creditCard.id,
    ledgerSplit: { method: 'EQUAL', shares },
  });
  await createTransaction(request, owner.token, ledger.id, {
    type: 'EXPENSE',
    amount: DINNER_CENTS,
    date,
    title: '晚餐',
    categoryId: expenseCategory.id,
    payerPersonId: personId(ming),
    ledgerSplit: { method: 'EQUAL', shares },
  });

  const settlement: CreateSettlementRequest = {
    fromPersonId: personId(hua),
    toPersonId: personId(owner),
    amount: SETTLEMENT_CENTS,
    date,
    toAccountId: cash.id,
  };
  const settlementResponse = await request.post(
    `${API_BASE_URL}/ledgers/${ledger.id}/settlements`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: settlement,
    },
  );
  if (!settlementResponse.ok()) {
    throw new Error(
      `建立小華付我現金的結清失敗：${settlementResponse.status()} ${await settlementResponse.text()}`,
    );
  }

  const accountBalancesBefore = (await listAccounts(request, owner.token))
    .map(({ id, balance }) => ({ id, balance }))
    .sort((left, right) => left.id.localeCompare(right.id));
  await signInAs(page, owner);

  return {
    owner,
    ming,
    hua,
    ledger,
    daily: { id: daily.id, name: TARGET_LEDGER_NAME },
    cash: { id: cash.id, initialBalance: cash.initialBalance },
    creditCard: { id: creditCard.id, initialBalance: creditCard.initialBalance },
    accountBalancesBefore,
  };
}

async function openLeaveDialog(page: Page, ledgerId: string) {
  await page.goto(`/ledgers/${ledgerId}`);
  await page.getByRole('button', { name: '退出帳本', exact: true }).click();
  return page.getByRole('dialog', { name: `退出「${SOURCE_LEDGER_NAME}」` });
}

async function expectBalances(
  request: APIRequestContext,
  user: TestUser,
  expected: Array<{ id: string; balance: number }>,
): Promise<void> {
  const actual = (await listAccounts(request, user.token))
    .map(({ id, balance }) => ({ id, balance }))
    .sort((left, right) => left.id.localeCompare(right.id));
  expect(actual).toEqual(expected);
}

async function leaveByApi(
  request: APIRequestContext,
  user: TestUser,
  ledgerId: string,
  targetLedgerId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/ledgers/${ledgerId}/leave`, {
    headers: { Authorization: `Bearer ${user.token}` },
    data: { targetLedgerId, excludedItemIds: [] },
  });
  if (response.status() !== 204) {
    throw new Error(`讓${user.name}退出帳本失敗：${response.status()} ${await response.text()}`);
  }
}

test('退出共享帳本：交易、帳戶餘額與帳本轉入合併到私人帳本', async ({ page, request }) => {
  test.setTimeout(150_000);
  const scenario = await createTripScenario(request, page);
  const dialog = await openLeaveDialog(page, scenario.ledger.id);

  await expect(dialog.getByRole('combobox', { name: '合併到' })).toHaveValue(scenario.daily.id);
  await expect(dialog.getByRole('region', { name: '帳戶' })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: '往來' })).toContainText('小華');
  await dialog.getByRole('button', { name: '退出', exact: true }).click();

  await expect(page).toHaveURL(/\/ledgers$/);
  await expect(page.getByRole('link', { name: SOURCE_LEDGER_NAME, exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: TARGET_LEDGER_NAME, exact: true }).click();
  await openTransactions(page);

  // 退出後只剩一本私人帳本，切換器會收成純文字；帳本清單 API 也只剩「日常」。
  await expect(page.getByText(TARGET_LEDGER_NAME, { exact: true })).toBeVisible();
  expect((await listLedgers(request, scenario.owner.token)).map((ledger) => ledger.id)).toEqual([
    scenario.daily.id,
  ]);

  const lodging = page.getByRole('listitem').filter({ hasText: '住宿' });
  const dinner = page.getByRole('listitem').filter({ hasText: '晚餐' });
  const settlement = page.getByRole('listitem').filter({ hasText: '結清' });
  await expect(lodging).toContainText('$3,000');
  await expect(lodging).toContainText(SOURCE_LEDGER_NAME);
  await lodging.getByRole('button', { name: '展開細項' }).click();
  await expect(lodging).toContainText('我的份額');
  await expect(lodging).toContainText('$1,000');
  await expect(lodging).toContainText('代墊');
  await expect(lodging).toContainText('$2,000');
  await expect(dinner).toContainText('$500');
  await expect(dinner).toContainText(SOURCE_LEDGER_NAME);
  await expect(settlement).toContainText(SOURCE_LEDGER_NAME);
  await expect(page.getByRole('listitem').filter({ hasText: SOURCE_LEDGER_NAME })).toHaveCount(3);

  await expectBalances(request, scenario.owner, scenario.accountBalancesBefore);
  await openDebtsTab(page, '總覽');
  const huaRow = debtRow(page, /^小華/);
  await expect(huaRow).toContainText('$500');
  const huaDetails = await expandDebtRow(page, /^小華/);
  await expect(huaDetails.getByText(SOURCE_LEDGER_NAME, { exact: true })).toBeVisible();
  await expect(huaDetails).toContainText('$500');
});

test('退出前取消住宿：信用卡預覽同步更新並保留其他合併項目', async ({ page, request }) => {
  test.setTimeout(150_000);
  const scenario = await createTripScenario(request, page);
  const cardBalanceBefore = scenario.accountBalancesBefore.find(
    (account) => account.id === scenario.creditCard.id,
  )?.balance;
  if (cardBalanceBefore === undefined) {
    throw new Error('帳戶快照裡找不到信用卡。');
  }

  const dialog = await openLeaveDialog(page, scenario.ledger.id);
  await dialog.getByRole('button', { name: /選擇交易/ }).click();
  const picker = page.getByRole('dialog', { name: '選擇交易' });
  const lodgingItem = picker.getByRole('listitem').filter({ hasText: '住宿' });
  await lodgingItem.getByRole('checkbox').uncheck();

  const expectedAccountChange = `${formatMoney(cardBalanceBefore)} → ${formatMoney(scenario.creditCard.initialBalance)}`;
  const pickerCardRow = picker
    .getByRole('region', { name: '帳戶' })
    .getByRole('listitem')
    .filter({ hasText: '信用卡' });
  await expect(pickerCardRow).toContainText(expectedAccountChange);
  await picker.getByRole('button', { name: '完成', exact: true }).click();

  const dialogCardRow = dialog
    .getByRole('region', { name: '帳戶' })
    .getByRole('listitem')
    .filter({ hasText: '信用卡' });
  await expect(dialogCardRow).toContainText(expectedAccountChange);
  await dialog.getByRole('button', { name: '退出', exact: true }).click();

  await expect(page).toHaveURL(/\/ledgers$/);
  await page.getByRole('link', { name: TARGET_LEDGER_NAME, exact: true }).click();
  await openTransactions(page);
  await expect(page.getByRole('listitem').filter({ hasText: '住宿' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
    SOURCE_LEDGER_NAME,
  );
  await expect(page.getByRole('listitem').filter({ hasText: '結清' })).toContainText(
    SOURCE_LEDGER_NAME,
  );

  const expectedBalances = scenario.accountBalancesBefore.map((account) =>
    account.id === scenario.creditCard.id
      ? { ...account, balance: scenario.creditCard.initialBalance }
      : account,
  );
  await expectBalances(request, scenario.owner, expectedBalances);
});

test('最後一位成員用刪除對話框合併帳本，必須輸入帳本名稱', async ({ page, request }) => {
  test.setTimeout(150_000);
  const scenario = await createTripScenario(request, page);
  const mingDaily = await personalLedger(request, scenario.ming.token);
  const huaDaily = await personalLedger(request, scenario.hua.token);
  await leaveByApi(request, scenario.ming, scenario.ledger.id, mingDaily.id);
  await leaveByApi(request, scenario.hua, scenario.ledger.id, huaDaily.id);

  await page.goto(`/ledgers/${scenario.ledger.id}`);
  await expect(page.getByRole('heading', { name: '成員（1）' })).toBeVisible();
  await page.getByRole('button', { name: '刪除帳本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `刪除「${SOURCE_LEDGER_NAME}」` });
  const deleteButton = dialog.getByRole('button', { name: '刪除', exact: true });
  await expect(dialog.getByLabel('輸入帳本名稱')).toBeVisible();
  await expect(deleteButton).toBeDisabled();
  await dialog.getByLabel('輸入帳本名稱').fill('不是帳本名稱');
  await expect(deleteButton).toBeDisabled();
  await dialog.getByLabel('輸入帳本名稱').fill(SOURCE_LEDGER_NAME);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page).toHaveURL(/\/ledgers$/);
  await expect(page.getByRole('link', { name: SOURCE_LEDGER_NAME, exact: true })).toHaveCount(0);
  await expect
    .poll(async () =>
      (await listLedgers(request, scenario.owner.token)).some(
        (ledger) => ledger.id === scenario.ledger.id,
      ),
    )
    .toBe(false);
  await expect(page.getByRole('link', { name: TARGET_LEDGER_NAME, exact: true })).toBeVisible();
  await expectBalances(request, scenario.owner, scenario.accountBalancesBefore);
  await page.getByRole('link', { name: TARGET_LEDGER_NAME, exact: true }).click();
  await openTransactions(page);
  await expect(page.getByRole('listitem').filter({ hasText: '住宿' })).toContainText(
    SOURCE_LEDGER_NAME,
  );
  await expect(page.getByRole('listitem').filter({ hasText: '晚餐' })).toContainText(
    SOURCE_LEDGER_NAME,
  );
  await expect(page.getByRole('listitem').filter({ hasText: '結清' })).toContainText(
    SOURCE_LEDGER_NAME,
  );
});

test('擁有者不能移除有帳的成員，改成檢視者後保留其帳本成員身分', async ({ page, request }) => {
  const owner = await registerUser(request, 'owner@example.com', '我');
  const ming = await registerUser(request, 'ming@example.com', '小明');
  const ledger = await createLedger(request, owner.token, {
    name: SOURCE_LEDGER_NAME,
    kind: 'SHARED',
  });
  await addMember(request, owner.token, ledger.id, { email: ming.email, role: 'EDITOR' });

  const people = await listLedgerPeople(request, ming.token, ledger.id);
  const expenseCategory = (await listCategories(request, ming.token, ledger.id)).find(
    (category) => category.type === 'EXPENSE',
  );
  const mingCash = (await listAccounts(request, ming.token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!expenseCategory || !mingCash || !people.some((person) => person.userId === ming.id)) {
    throw new Error('建立移除成員前置資料時缺少小明的帳本成員、分類或現金帳戶。');
  }
  await createTransaction(request, ming.token, ledger.id, {
    type: 'EXPENSE',
    amount: 10_000,
    date: new Date().toISOString(),
    title: '晚餐',
    categoryId: expenseCategory.id,
    accountId: mingCash.id,
  });

  await signInAs(page, owner);
  await page.goto(`/ledgers/${ledger.id}`);
  const memberList = page.getByRole('list', { name: '帳本成員' });
  const mingRow = memberList.getByRole('listitem').filter({ hasText: '小明' });
  await mingRow.getByRole('combobox', { name: '小明的角色' }).selectOption({ label: '移除' });

  const dialog = page.getByRole('dialog', { name: '移除成員' });
  await expect(
    dialog.getByText('將 小明 移出這本帳本？他先前記的交易會留下。', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '移除', exact: true }).click();
  await expect(
    dialog.getByText('小明在這本帳本有帳，只能改成檢視者', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '改成檢視者', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '移除', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '改成檢視者', exact: true }).click();

  await expect(mingRow.getByRole('combobox', { name: '小明的角色' })).toHaveValue('VIEWER');
  const detailResponse = await request.get(`${API_BASE_URL}/ledgers/${ledger.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(detailResponse.ok()).toBe(true);
  const detail = (await detailResponse.json()) as LedgerDetail;
  expect(detail.members.find((member) => member.userId === ming.id)?.role).toBe('VIEWER');
});
