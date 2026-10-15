import {
  addMember,
  createCounterparty,
  createDebtEntry,
  createLedger,
  createTransaction,
  listAccounts,
  linkByEmail,
  listCategories,
  listLedgerPeople,
  registerUser,
  renameCounterparty,
} from './api';
import { expect, test } from './fixtures';
import { debtEntry, debtRow, expandDebtRow, openDebtsTab } from './ui';

/**
 * 3f 的 Web 主線（spec `phase-3f-unified-debts.md` §6、SC-F11）：設定指向 → 借還頁總額
 * → 帳本來源記結清 → 總額更新 → 帳本頁的單一成員清單。
 *
 * 金額、合併、分組、兩清過濾、有效指向全部來自 API（spec §7 Never），所以這裡不透過畫面
 * 重建那些數字，只斷言畫面「照 API 給的值顯示」：總額、展開的來源、預填的結清表單。
 * 前置資料（連動、個人往來、共享帳本與分帳支出）走 API 建立（D3），被測的動線才用畫面。
 *
 * ## 3g 改了什麼（`docs/specs/phase-3g-debts-inline.md`）
 *
 * 總覽的展開區只看不操作（W156），所以 3f「點帳本來源就切到結清、預填」改成：到共享分頁，
 * 點那一筆轉帳的方塊，預填的表單在方塊那一排下方展開（W158、W159）。作用中帳本只在明細那一排
 * 顯示（W151），所以 3f 驗「切換作用中帳本」的那一步拿掉了。
 *
 * 3h 更新：共享帳本由甲付款的 API 前置支出明確指定甲的真正帳戶。
 */

/** 個人往來：明哥欠我 500 元。 */
const PERSONAL_CENTS = 50_000;
/** 一筆 900 元支出由我付、三人均分，結清轉帳是 小明→我 與 小華→我 各 300 元。 */
const LEDGER_CENTS = 30_000;
const EXPENSE_CENTS = LEDGER_CENTS * 3;

test('3f 主線：指向、借還總額、展開來源、共享分頁記結清、總額更新、帳本頁單一成員清單', async ({
  signedInPage: page,
  userA,
  request,
}) => {
  test.setTimeout(150_000);
  const today = new Date().toISOString();

  // --- 準備：我（userA）與小明連動並叫他「明哥」；他欠我 500。 ---
  const ming = await registerUser(request, 'ming@example.com', '小明');
  const hua = await registerUser(request, 'hua@example.com', '小華');
  const { inviterSideId: mingId } = await linkByEmail(request, userA, ming);
  await renameCounterparty(request, userA.token, mingId, '明哥');
  await createDebtEntry(request, userA.token, {
    counterparty: { id: mingId },
    kind: 'LEND',
    amount: PERSONAL_CENTS,
    date: today,
  });

  // --- 準備：共享帳本「花蓮三日」，我付一筆 900 元三人均分。 ---
  const ledger = await createLedger(request, userA.token, {
    name: '花蓮三日',
    kind: 'SHARED',
  });
  await addMember(request, userA.token, ledger.id, { email: ming.email, role: 'EDITOR' });
  await addMember(request, userA.token, ledger.id, { email: hua.email, role: 'EDITOR' });
  const people = await listLedgerPeople(request, userA.token, ledger.id);
  const shareIds = [userA, ming, hua].map((user) => {
    const person = people.find((candidate) => candidate.userId === user.id);
    if (!person) {
      throw new Error(`帳本裡找不到 ${user.name} 的 LedgerPerson。`);
    }
    return person.id;
  });
  const expenseCategory = (await listCategories(request, userA.token, ledger.id)).find(
    (category) => category.type === 'EXPENSE',
  );
  if (!expenseCategory) {
    throw new Error('共享帳本找不到支出分類。');
  }
  const cashAccount = (await listAccounts(request, userA.token)).find(
    (account) => account.name === '現金' && !account.isTemporary,
  );
  if (!cashAccount) {
    throw new Error('找不到甲的現金帳戶。');
  }
  await createTransaction(request, userA.token, ledger.id, {
    type: 'EXPENSE',
    amount: EXPENSE_CENTS,
    date: today,
    categoryId: expenseCategory.id,
    accountId: cashAccount.id,
    ledgerSplit: { method: 'EQUAL', shares: shareIds.map((personId) => ({ personId })) },
  });

  // --- 準備：未連動對象「房東」，之後把小華指向他。 ---
  await createCounterparty(request, userA.token, '房東');

  // --- 對象頁：帳本群組、自動指向（小明→明哥）、手動指向（小華→房東）。 ---
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '對象' })
    .click();
  await page.getByRole('heading', { level: 2, name: '對象' }).waitFor();
  const ledgerGroup = page.getByRole('region', { name: '花蓮三日' });
  await expect(ledgerGroup).toBeVisible();
  await expect(ledgerGroup).toContainText('共享帳本');
  const mingRow = ledgerGroup.getByRole('listitem').filter({ hasText: '小明' });
  await expect(mingRow).toContainText('→ 明哥');

  const huaRow = ledgerGroup.getByRole('listitem').filter({ hasText: '小華' });
  await huaRow.getByRole('button', { name: '指向' }).click();
  const pointerDialog = page.getByRole('dialog', { name: '小華' });
  await pointerDialog.getByLabel('指向已建立的對象').selectOption({ label: '房東' });
  await pointerDialog.getByRole('button', { name: '儲存' }).click();
  await expect(huaRow).toContainText('→ 房東');

  // --- 借還總覽：總額＝個人往來＋帳本來源，展開看來源，未指向的金額掛在房東身上（W156）。 ---
  await openDebtsTab(page, '總覽');
  const mingTotal = page.getByRole('main').getByRole('button', { name: /^明哥/ });
  await expect(mingTotal).toContainText('明哥欠你 $800');

  const mingPanel = await expandDebtRow(page, /^明哥/);
  // 展開區上面是個人往來未還清的紀錄，下面是共享帳本來源。只看，沒有「⋯」也沒有「記一筆」。
  await expect(debtEntry(mingPanel, '我借給明哥 $500')).toHaveCount(1);
  await expect(mingPanel.getByRole('heading', { name: '花蓮三日' })).toBeVisible();
  await expect(mingPanel.getByRole('group', { name: '小明欠你 $300', exact: true })).toBeVisible();
  await expect(mingPanel.getByRole('button', { name: '更多操作' })).toHaveCount(0);
  await expect(mingPanel.getByRole('button', { name: '記一筆', exact: true })).toHaveCount(0);

  const landlordRow = debtRow(page, /^房東/);
  await expect(landlordRow).toContainText('房東欠你 $300');

  // --- 借還共享：花蓮三日的轉帳方塊，點了預填結清表單（3g W158、W159）。 ---
  await openDebtsTab(page, '共享');
  const ledgerCard = page.getByRole('region', { name: '花蓮三日' });
  const mingTransfer = ledgerCard.getByRole('button', { name: '小明欠我 $300', exact: true });
  await mingTransfer.click();
  await expect(mingTransfer).toHaveAttribute('aria-expanded', 'true');

  // 表單在那一排下方全寬展開，範圍就是這張卡片：預填 小明 ─▶ 我 $300。
  const settleForm = ledgerCard;
  const payerSelect = settleForm.getByLabel('付錢的人');
  const payerOption = payerSelect.getByRole('option', { name: '小明', exact: true });
  await expect(payerSelect).toHaveValue((await payerOption.getAttribute('value')) ?? '');
  const receiverSelect = settleForm.getByLabel('收錢的人');
  const receiverOption = receiverSelect.getByRole('option', { name: '我', exact: true });
  await expect(receiverSelect).toHaveValue((await receiverOption.getAttribute('value')) ?? '');
  await expect(settleForm.getByLabel('金額')).toHaveValue('300');

  const settlementResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/ledgers/${ledger.id}/settlements`),
  );
  await settleForm.getByRole('button', { name: '新增', exact: true }).click();
  expect((await settlementResponse).ok()).toBe(true);
  // 存檔後小明這一筆已兩清，方塊就不見了（只剩小華還欠的那一塊）。
  await expect(mingTransfer).toHaveCount(0);

  // --- 回借還總覽：總額回到 500，小明那一段來源沒了（已兩清）。小華仍欠 300：她指向房東，金額照樣掛在房東那一列。 ---
  await openDebtsTab(page, '總覽');
  await expect(mingTotal).toContainText('明哥欠你 $500');
  const mingPanelAgain = await expandDebtRow(page, /^明哥/);
  await expect(mingPanelAgain.getByRole('heading', { name: '花蓮三日' })).toHaveCount(0);
  await expect(landlordRow).toContainText('房東欠你 $300');

  // --- 帳本頁：單一成員清單、不顯示 email、「新增成員」滑出兩個選項（W140～W143）。 ---
  await page.goto(`/ledgers/${ledger.id}`);
  await expect(page.getByRole('heading', { name: '成員（3）' })).toBeVisible();
  const memberList = page.getByRole('list', { name: '帳本成員' });
  await expect(memberList).toHaveCount(1);
  await expect(memberList).not.toContainText('example.com');
  await expect(memberList.getByText('小明', { exact: true })).toBeVisible();
  await expect(memberList.getByText('→ 明哥')).toBeVisible();

  await page.getByRole('button', { name: '新增成員', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增對象' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增虛擬成員' })).toBeVisible();
});
