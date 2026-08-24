import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { registerUser, type TestUser } from './api';
import { resetDb } from './db';

/**
 * 測試的共用前置條件（Playwright 稱為 fixture）。
 *
 * 每個測試都從「空的資料庫 ＋ 兩個剛註冊好的帳號」開始。這樣測試之間不共享任何
 * 狀態，順序換了、只跑其中一條，結果都一樣。
 */

/**
 * 前端存 JWT 的 localStorage 鍵名，見 `src/lib/token-storage.ts`。
 *
 * ⚠️ 那邊改了鍵名，這裡要跟著改，否則所有「已登入」的測試會安靜地變成未登入。
 */
const TOKEN_KEY = 'ledger.accessToken';

/** 兩個測試帳號：A 是帳本的擁有者，B 是被邀請的成員。 */
export const USER_A_EMAIL = 'a@example.com';
export const USER_B_EMAIL = 'b@example.com';

interface LedgerFixtures {
  /** 每個測試前自動清空資料庫；測試不必自己呼叫。 */
  cleanDb: void;
  /** 帳本的擁有者。 */
  userA: TestUser;
  /** 被邀請的另一位使用者。 */
  userB: TestUser;
  /** 已經以 userA 身分登入的頁面。 */
  signedInPage: Page;
  /**
   * 開一個以指定帳號登入的**獨立**瀏覽器分頁（P3）。
   *
   * 每個分頁有自己的 context，也就有自己的 localStorage 與 cookie，等同兩台電腦。
   * 情境 3、4 要同時看 A 與 B 的畫面，靠的就是這個。
   * 測試結束時自動關閉，呼叫端不必收尾。
   */
  openAs: (user: TestUser) => Promise<Page>;
}

/** 把 token 放進 localStorage，讓頁面一載入就是已登入狀態。 */
async function signIn(page: Page, user: TestUser): Promise<void> {
  // addInitScript 在**每個文件開始執行前**注入，所以 app 的第一次讀取就拿得到 token。
  // 先 goto 再寫 localStorage 的話，app 已經以未登入狀態渲染過一輪了。
  await page.addInitScript(
    ([key, token]) => {
      window.localStorage.setItem(key!, token!);
    },
    [TOKEN_KEY, user.token],
  );
  await page.goto('/');
}

export const test = base.extend<LedgerFixtures>({
  /**
   * `auto: true` 代表每個測試都會跑，即使測試沒有列出它。
   *
   * 不走 `beforeEach` 的理由：fixture 的建立早於 `beforeEach`，而下面的
   * `userA` / `userB` 是 fixture——用 `beforeEach` 清資料庫的話，會在帳號註冊
   * **之後**才清，把它們清掉。
   */
  cleanDb: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],

  userA: async ({ request }, use) => {
    await use(await registerUser(request, USER_A_EMAIL, '甲'));
  },

  userB: async ({ request }, use) => {
    await use(await registerUser(request, USER_B_EMAIL, '乙'));
  },

  signedInPage: async ({ page, userA }, use) => {
    await signIn(page, userA);
    await use(page);
  },

  openAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (user) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, user);
      return page;
    });

    for (const context of contexts) {
      await context.close();
    }
  },
});

export { expect };
