import {
  createAccount,
  createCategory,
  createLedger,
  listAccounts,
  listLedgerTransactions,
  personalLedger,
} from './api';
import { expect, test } from './fixtures';
import {
  newTransactionForm,
  openTransactions,
  selectCategory,
  switchLedger,
  transactionRow,
} from './ui';

const TWO_MEALS_TEXT = '早餐 60 現金、午餐 120 刷卡';

/**
 * 真瀏覽器連到真實 API，以固定假 provider 驗證 AI 草稿確認、表單修改與跨帳本寫入。
 * 前置帳本、分類和帳戶經 API helper 建立；被測的送出、確認和表單操作都從畫面完成。
 */
test.describe('AI 文字記帳草稿', () => {
  test('確認單筆草稿後更新明細與帳戶餘額，並保留其他草稿', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { personal, cash } = await createAiDraftCatalog(request, userA.token);
    await submitAiText(page, TWO_MEALS_TEXT);

    const confirmBreakfast = page.getByRole('button', { name: '確認草稿：早餐', exact: true });
    await expect(confirmBreakfast).toBeVisible();
    await expect(page.getByRole('button', { name: '編輯草稿：午餐', exact: true })).toBeVisible();

    await confirmBreakfast.click();

    const breakfastRow = transactionRow(page, '-$60');
    await expect(breakfastRow).toContainText('早餐');
    await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '編輯草稿：午餐', exact: true })).toBeVisible();

    const savedTransactions = await listLedgerTransactions(request, userA.token, personal.id);
    expect(
      savedTransactions.items.some(
        (transaction) => transaction.amount === 6000 && transaction.account?.id === cash.id,
      ),
    ).toBe(true);

    const accounts = await listAccounts(request, userA.token);
    expect(accounts.find((account) => account.id === cash.id)?.balance).toBe(cash.balance - 6000);
  });

  test('關閉草稿表單仍保留草稿，改金額後新增使用新金額', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { personal, cash } = await createAiDraftCatalog(request, userA.token);
    await submitAiText(page, TWO_MEALS_TEXT);

    const editBreakfast = page.getByRole('button', { name: '編輯草稿：早餐', exact: true });
    await expect(editBreakfast).toBeVisible();
    await editBreakfast.click();
    await expect(newTransactionForm(page)).toBeVisible();

    await page.getByRole('button', { name: '收起新增面板', exact: true }).click();
    await expect(page.locator('[data-registered]')).not.toHaveAttribute('data-open');
    await expect(editBreakfast).toBeVisible();

    await editBreakfast.click();
    const form = newTransactionForm(page);
    await form.getByLabel('金額').fill('65');
    await form.getByRole('button', { name: '新增', exact: true }).click();

    await expect(transactionRow(page, '-$65')).toContainText('早餐');
    await expect(page.getByRole('button', { name: '編輯草稿：早餐', exact: true })).toHaveCount(0);

    const savedTransactions = await listLedgerTransactions(request, userA.token, personal.id);
    expect(
      savedTransactions.items.some(
        (transaction) => transaction.amount === 6500 && transaction.account?.id === cash.id,
      ),
    ).toBe(true);
  });

  test('補上別本帳本的分類後，交易只出現在所屬帳本', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    const { personal, travel, flightCategory } = await createAiDraftCatalog(request, userA.token);
    await submitAiText(page, '旅行基金 機票 8000 刷卡');

    const editFlight = page.getByRole('button', { name: '編輯草稿：機票', exact: true });
    const flightRow = page.getByRole('listitem').filter({ has: editFlight });
    await expect(flightRow).toContainText('旅行基金');
    await expect(flightRow).toContainText('分類未提供');
    await expect(page.getByRole('button', { name: '確認草稿：機票', exact: true })).toBeDisabled();

    await editFlight.click();
    const form = newTransactionForm(page);
    await selectCategory(form, flightCategory.name);
    await form.getByRole('button', { name: '新增', exact: true }).click();

    await expect(page.getByRole('button', { name: '編輯草稿：機票', exact: true })).toHaveCount(0);
    const personalTransactions = await listLedgerTransactions(request, userA.token, personal.id);
    expect(personalTransactions.items.some((transaction) => transaction.amount === 800000)).toBe(
      false,
    );

    await switchLedger(page, travel.name);
    const travelFlightRow = transactionRow(page, '-$8,000');
    await expect(travelFlightRow).toContainText('機票');

    const travelTransactions = await listLedgerTransactions(request, userA.token, travel.id);
    expect(
      travelTransactions.items.some(
        (transaction) =>
          transaction.amount === 800000 && transaction.category?.id === flightCategory.id,
      ),
    ).toBe(true);

    await switchLedger(page, personal.name);
    await expect(transactionRow(page, '-$8,000')).toHaveCount(0);
  });
});

/** 依假 provider 的名稱精確準備目錄，讓固定劇本以名稱找出測試資料代號。 */
async function createAiDraftCatalog(request: Parameters<typeof personalLedger>[0], token: string) {
  const personal = await personalLedger(request, token);
  const travel = await createLedger(request, token, { name: '旅行基金' });
  const cash = (await listAccounts(request, token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!cash) throw new Error('測試帳號缺少預設的「現金」帳戶。');

  await createAccount(request, token, { name: '信用卡' });
  await createCategory(request, token, personal.id, { name: '早餐', type: 'EXPENSE' });
  await createCategory(request, token, personal.id, { name: '午餐', type: 'EXPENSE' });
  const flightCategory = await createCategory(request, token, travel.id, {
    name: '機票',
    type: 'EXPENSE',
  });

  return { personal, travel, cash, flightCategory };
}

async function submitAiText(page: import('@playwright/test').Page, text: string): Promise<void> {
  // 測試資料由 API 建好後重新載入，讓畫面重新讀到新帳本與分類清單。
  await page.reload();
  await openTransactions(page);
  await page.getByRole('textbox', { name: '用一句話記帳' }).fill(text);
  await page.getByRole('button', { name: '送出', exact: true }).click();
}
