import { expect, type Locator, type Page } from '@playwright/test';
import { formatMoney, parseMoneyInput, type Cents } from '@ledger/shared';

/**
 * 畫面操作的共用輔助函式。
 *
 * 定位一律用可及性選取器（`getByRole` / `getByLabel`）。**不可以用 CSS class**
 * ——CSS Modules 的 class 名稱是編譯產生的，改個樣式就爛。
 */

/** 把畫面金額交給 shared 解析成分，讓 e2e 比較時沿用 API 的整數單位。 */
export function parseAmount(text: string | null): Cents {
  const amount = parseMoneyInput((text ?? '').replace(/[$,\s]/g, ''), { allowNegative: true });
  if (amount === null) {
    throw new Error(`畫面金額格式無效：${text ?? ''}`);
  }
  return amount;
}

/** 比對預覽列的現在與之後餘額，忽略 JSX 節點之間不影響閱讀的空白。 */
export async function expectBalanceTransition(
  row: Locator,
  current: Cents,
  after: Cents,
): Promise<void> {
  const expected = `${formatMoney(current)}→${formatMoney(after)}`.replace(/\s+/g, '');
  await expect.poll(async () => (await row.innerText()).replace(/\s+/g, '')).toContain(expected);
}

/**
 * 切換上方橫條的作用中帳本。只有一本帳本時切換器是一段文字，不是下拉。
 *
 * 2i 第三輪（SC-40）：切換器是自己做的清單，不是原生 `<select>`，所以改成
 * 「點開按鈕 → 點選項」。選項名稱後面還帶著「私人／共享」小標籤，用包含比對。
 */
export async function switchLedger(page: Page, name: string): Promise<void> {
  const switcher = page.getByRole('group', { name: '作用中帳本' });
  await switcher.getByRole('button').click();
  await switcher.getByRole('option', { name }).click();
}

/**
 * 首頁「新增一筆交易」的表單。
 *
 * 首頁上有兩個「分類」下拉——新增表單一個、篩選列一個——所以整頁找會同時對到兩個。
 * fieldset 的 `<legend>` 就是這個群組的無障礙名稱。
 */
export function newTransactionForm(page: Page): Locator {
  return page.getByRole('group', { name: '新增一筆交易' });
}

/**
 * 右側欄按關閉後的樣子（修訂 3 W57）：欄位收起，內容仍留在 inert 的欄位裡讓滑出動畫顯示
 * 同一個面板，而且沒有換成「新增一筆交易」。所以不檢查面板消失，改檢查欄位與新增表單。
 */
export async function expectRightPanelClosedWithoutAddForm(page: Page): Promise<void> {
  await expect(page.locator('[data-registered]')).not.toHaveAttribute('data-open');
  await expect(newTransactionForm(page)).toHaveCount(0);
}

/** 交易列表的篩選列。 */
export function transactionFilters(page: Page): Locator {
  return page.getByRole('region', { name: '篩選交易' });
}

/** 展開交易篩選後回傳四個欄位所在的區域。 */
export async function openTransactionFilters(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: '篩選' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const filters = transactionFilters(page);
  await filters.waitFor({ state: 'visible' });
  return filters;
}

/** 透過圖示選項挑分類，讓表單 e2e 走與使用者相同的可見選單。 */
export async function selectCategory(scope: Locator, categoryName: string): Promise<void> {
  await scope.getByRole('combobox', { name: '分類' }).click();
  await scope
    .getByRole('listbox', { name: '分類' })
    .getByRole('option', { name: categoryName, exact: true })
    .click();
}

/** 交易列表裡符合某段文字的那一列（例如金額）。 */
export function transactionRow(page: Page, hasText: string): Locator {
  return page.getByRole('listitem').filter({ hasText });
}

/** 首頁交易列位於目前分頁中，限定查找範圍以避開我的帳戶清單項目。 */
export function homeActivityRow(page: Page, hasText: string): Locator {
  return page.getByRole('tabpanel').getByRole('listitem').filter({ hasText });
}

/** 共用首頁卡片順序與響應式排列驗收，直接檢查新版版面資料與實際方框。 */
export async function expectHomeSectionOrder(page: Page, viewportWidth: number): Promise<void> {
  const cardIds = [
    'expense',
    'income',
    'net',
    'trend',
    'categories',
    'activity',
    'accounts',
    'debts',
  ] as const;
  const pageHeading = page.getByRole('heading', { level: 2, name: '總覽' });
  const layout = page.locator(
    viewportWidth <= 900 ? '[data-home-layout="narrow"]' : '[data-home-layout="tree"]',
  );
  await expect(pageHeading).toBeVisible();
  await expect(layout).toBeVisible();

  const actualCardIds = await layout
    .locator('[data-home-card-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-home-card-id')),
    );
  expect(actualCardIds).toEqual(cardIds);
  const cards = Object.fromEntries(
    await Promise.all(
      cardIds.map(
        async (cardId) =>
          [
            cardId,
            await requiredBoundingBox(layout.locator(`[data-home-card-id="${cardId}"]`)),
          ] as const,
      ),
    ),
  ) as Record<(typeof cardIds)[number], NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>>;

  if (viewportWidth <= 900) {
    for (let index = 1; index < cardIds.length; index += 1) {
      const previous = cards[cardIds[index - 1]!];
      const current = cards[cardIds[index]!];
      expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height - 1);
    }
    return;
  }

  let rowTop = cards[cardIds[0]].y;
  let rowBottom = cards[cardIds[0]].y + cards[cardIds[0]].height;
  let previousCard = cards[cardIds[0]];
  for (const cardId of cardIds.slice(1)) {
    const current = cards[cardId];
    if (Math.abs(current.y - rowTop) <= 2) {
      expect(current.x).toBeGreaterThanOrEqual(previousCard.x + previousCard.width - 2);
      rowBottom = Math.max(rowBottom, current.y + current.height);
    } else {
      expect(current.y).toBeGreaterThanOrEqual(rowBottom - 2);
      rowTop = current.y;
      rowBottom = current.y + current.height;
    }
    previousCard = current;
  }

  const pendingCard = page.locator('section[aria-labelledby="pending-card-heading"]');
  if ((await pendingCard.count()) > 0 && (await pendingCard.isVisible())) {
    const pendingBox = await requiredBoundingBox(pendingCard);
    const firstRowBottom = Math.max(
      ...cardIds.slice(0, 3).map((cardId) => cards[cardId].y + cards[cardId].height),
    );
    expect(pendingBox.y).toBeGreaterThanOrEqual(firstRowBottom - 2);
    expect(cards.trend.y).toBeGreaterThanOrEqual(pendingBox.y + pendingBox.height - 2);
  }
}

async function requiredBoundingBox(locator: Locator) {
  let box = await locator.boundingBox();
  await expect
    .poll(async () => {
      box = await locator.boundingBox();
      return box !== null;
    })
    .toBe(true);
  expect(box).not.toBeNull();
  if (!box) throw new Error('首頁版面驗收找不到區塊方框。');
  return box;
}

/**
 * 從側欄走到交易頁（spec 2i：交易表格從首頁搬到 `/transactions`）。
 *
 * 點連結而不是 `goto`：`goto` 會整頁重新載入，把 React Query 的快取一起清掉，
 * 測試就驗不到「改動之後畫面有沒有跟著更新」。
 */
export async function openTransactions(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '交易' })
    .click();
  // 精確比對：右側欄開著「編輯交易」時，那個標題也含「交易」，模糊比對會對到兩個。
  await page.getByRole('heading', { level: 2, name: '交易', exact: true }).waitFor();
}

/** 從側欄回到首頁（dashboard）。理由同 `openTransactions`。 */
export async function openDashboard(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主要導覽' })
    .getByRole('link', { name: '首頁' })
    .click();
  await page.getByRole('heading', { level: 2, name: '總覽' }).waitFor();
}

/**
 * 打開右側欄的新增表單（spec 2i 第二輪修訂 5：右側欄預設關閉）。
 * 「＋ 新增交易」在總覽與交易頁的上方橫條右邊。
 */
export async function openNewTransaction(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新增交易' }).click();
  await newTransactionForm(page).getByLabel('金額').waitFor();
}

/**
 * 彈窗的內容不可以比彈窗寬（不能出現橫向捲軸）。
 *
 * jsdom 不做排版，元件測試抓不到這種問題，只能在真的瀏覽器裡量。
 */
export async function expectNoHorizontalOverflow(dialog: Locator): Promise<void> {
  const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  if (overflow > 0) {
    throw new Error(`彈窗內容比彈窗寬 ${overflow}px，會出現橫向捲軸`);
  }
}

/**
 * 在選人的下拉選單（3b-2 W24）輸入名字，再按 Esc 收起清單。
 *
 * 用 combobox 角色找輸入框：`getByLabel` 是部分比對，會同時對到清單本身
 * （它的名稱是「{label}選項」）。收起清單是因為它會蓋住下方的種類按鈕。
 */
export async function typeCounterparty(
  scope: Locator,
  name: string,
  label = '對象',
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label, exact: true });
  await input.fill(name);
  await input.press('Escape');
}

/**
 * 打開側欄底部的使用者選單（spec 2i SC-32）。「登出」「個人資料」都收在裡面。
 * 取不到使用者名稱時按鈕叫「帳號選單」，所以兩種名稱都接受。
 */
export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /的選單$|^帳號選單$/ }).click();
}

// ---------------------------------------------------------------------------
// 借還（3g）：子分頁、列內展開、紀錄的「⋯」與撤銷。
// 3g 拿掉了右側欄的往來帳，展開、操作都在列上，所以下面的輔助都以「那一列」為範圍。
// ---------------------------------------------------------------------------

/** 借還的四個子分頁（3g W150）。網址是 `?view=debts&tab=…`，預設總覽。 */
export type DebtsSubTab = '總覽' | '個人' | '共享' | '歷史';

/**
 * 從交易頁打開借還檢視的某個子分頁。借還的檢視切換與子分頁都在交易頁，所以先走到交易頁。
 */
export async function openDebtsTab(page: Page, tab: DebtsSubTab): Promise<void> {
  await openTransactions(page);
  const viewButton = page
    .getByRole('group', { name: '檢視', exact: true })
    .getByRole('button', { name: '借還', exact: true });
  await viewButton.click();
  await expect(viewButton).toHaveAttribute('aria-pressed', 'true');

  const tabButton = page
    .getByRole('group', { name: '借還', exact: true })
    .getByRole('button', { name: tab, exact: true });
  await tabButton.click();
  // 等子分頁真的切過去。aria-pressed 與新內容在同一次渲染更新；切換前舊分頁的列還在 DOM 裡，
  // 不等的話，接著展開一列會讀到舊分頁的狀態（例如 aria-expanded 還是 true），判斷就失準。
  await expect(tabButton).toHaveAttribute('aria-pressed', 'true');
}

/**
 * 借還列表裡一個人（或一本帳本）的那一排按鈕。點它就在那一排下方展開（3g W153）。
 * 列表與歷史都有可能出現同名的列，取第一個就夠用：各測試的名字都是唯一的。
 */
export function debtRow(page: Page, name: string | RegExp): Locator {
  return page.getByRole('main').getByRole('button', { name }).first();
}

/**
 * 把一排展開，回傳那一整列（`<li>`）。展開區的內容都在這一列裡，後續的斷言與操作
 * 限定在它之內，不會誤碰到別的對象。已經展開就不再點，避免點一下又收起。
 */
export async function expandDebtRow(page: Page, name: string | RegExp): Promise<Locator> {
  const row = debtRow(page, name);
  // 先等列出現再讀狀態，避免讀到還沒換掉的舊 DOM。
  await row.waitFor({ state: 'visible' });
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click();
  }
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  return row.locator('xpath=ancestor::li[1]');
}

/** 收起一排。已經收起就不動。 */
export async function collapseDebtRow(page: Page, name: string | RegExp): Promise<void> {
  const row = debtRow(page, name);
  await row.waitFor({ state: 'visible' });
  if ((await row.getAttribute('aria-expanded')) === 'true') {
    await row.click();
  }
  await expect(row).toHaveAttribute('aria-expanded', 'false');
}

/**
 * 展開區裡的一筆往來紀錄。列的無障礙名稱是完整句子（例如「我借給明哥 $500」，見
 * `entry-flow.ts`），所以用它定位，不靠視覺上的箭頭或位置。
 */
export function debtEntry(scope: Locator, description: string): Locator {
  return scope.getByLabel(description, { exact: true });
}

/** 一筆紀錄右邊的「⋯」選單；3h 的結清分支沒有自己的操作按鈕。 */
export function entryMenu(entry: Locator): Locator {
  return entry.getByRole('button', { name: '更多操作', exact: true });
}

/**
 * 撤銷確認框（3g W171）：標題「撤銷這筆？」，按鈕「取消」「撤銷」。點了撤銷並等對話框關掉。
 */
export async function confirmUndo(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '撤銷這筆？' });
  await dialog.getByRole('button', { name: '撤銷', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** 用「⋯」→「撤銷」撤掉一筆紀錄，並確認。 */
export async function undoEntry(page: Page, entry: Locator): Promise<void> {
  await entryMenu(entry).click();
  await page.getByRole('menuitem', { name: '撤銷', exact: true }).click();
  await confirmUndo(page);
}
