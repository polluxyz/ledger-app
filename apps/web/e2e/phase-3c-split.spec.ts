import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  addMember,
  createCounterparty,
  createLedger,
  linkByEmail,
  listAccounts,
  listCategories,
  personalLedger,
} from './api';
import { expect, test, USER_B_EMAIL } from './fixtures';
import {
  newTransactionForm,
  openNewTransaction,
  openTransactions,
  selectCategory,
  switchLedger,
  transactionRow,
} from './ui';

async function cash(request: APIRequestContext, token: string): Promise<number> {
  const accounts = await listAccounts(request, token);
  return accounts.find((account) => account.name === '現金')!.balance;
}

async function choosePerson(form: Locator, name: string): Promise<void> {
  const picker = form.getByRole('combobox', { name: '＋ 新增分帳對象', exact: true });
  await picker.fill(name);
  // 已連動的人選項名稱後面帶「連動」（例：「乙 連動」），所以比對開頭。
  await form.getByRole('option', { name: new RegExp(`^${name}`) }).click();
}

function pendingRow(page: Page, title: string): Locator {
  return page
    .getByRole('region', { name: /待確認/ })
    .getByRole('listitem')
    .filter({ hasText: title });
}

test('SC-W80：甲記晚餐分帳，乙接受並在自己的帳本記下一份', async ({
  signedInPage: pageA,
  userA,
  userB,
  openAs,
  request,
}) => {
  const ledger = await createLedger(request, userA.token, {
    name: '晚餐分帳',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: USER_B_EMAIL, role: 'EDITOR' });
  const linkedCounterparty = await linkByEmail(request, userA, userB);
  await createCounterparty(request, userA.token, '小華');
  const category = (await listCategories(request, userA.token, ledger.id)).find(
    (item) => item.type === 'EXPENSE',
  )!;
  const bCashBefore = await cash(request, userB.token);
  // 乙把自己那份記進自己的個人帳本：乙也是共享帳本的成員，在那本帳本會看到甲的每一筆交易
  // （spec 3c SC-S16），名稱都是「晚餐」，分不出哪一筆是自己的。
  const bPersonal = await personalLedger(request, userB.token);
  const bCategory = (await listCategories(request, userB.token, bPersonal.id)).find(
    (item) => item.type === 'EXPENSE',
  )!;

  await pageA.reload();
  await switchLedger(pageA, ledger.name);
  await openTransactions(pageA);
  await openNewTransaction(pageA);
  const form = newTransactionForm(pageA);
  await form.getByLabel('金額').fill('3000');
  await form.getByLabel('日期').fill(new Date().toISOString().slice(0, 10));
  await selectCategory(form, category.name);
  await form.getByLabel('名稱').fill('晚餐');
  await form.getByRole('checkbox', { name: '分帳' }).check();
  await choosePerson(form, '乙');
  await choosePerson(form, '小華');

  await expect(form.getByRole('region', { name: '分帳' })).toContainText('$1,000');
  await form.getByRole('button', { name: '新增', exact: true }).click();
  const aRow = transactionRow(pageA, '晚餐');
  await expect(aRow).toBeVisible();
  await expect(aRow).toContainText('-$3,000');
  await expect(aRow).toContainText('分帳');

  const pageB = await openAs(userB);
  await switchLedger(pageB, ledger.name);
  const proposal = pendingRow(pageB, '晚餐');
  await expect(proposal).toContainText('幫你付');
  await proposal.getByRole('button', { name: '接受' }).click();
  await expect(proposal.getByLabel('名稱')).toHaveValue('晚餐');
  await expect(proposal.getByLabel('分類')).toBeVisible();
  await expect(proposal.getByLabel('帳戶')).toHaveCount(0);
  await proposal.getByLabel('記在哪本帳本').selectOption(bPersonal.id);
  // 待確認卡片的分類仍是原生下拉（3d 只把記帳表單換成圖示選單）。
  await proposal.getByLabel('分類').selectOption(bCategory.id);
  await proposal.getByRole('button', { name: '接受' }).click();

  await switchLedger(pageB, bPersonal.name);
  await openTransactions(pageB);
  const bRow = transactionRow(pageB, '晚餐');
  await expect(bRow).toBeVisible();
  await expect(bRow).toContainText('-$1,000');
  expect(await cash(request, userB.token)).toBe(bCashBefore);

  // 連動對象 id 由 API 建立，確定甲送出的名單使用了這位乙。
  expect(linkedCounterparty.inviterSideId).toBeTruthy();
});
