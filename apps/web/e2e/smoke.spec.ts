import { expect, test } from '@playwright/test';
import { resetDb } from './db';
import { API_BASE_URL } from './env';

/**
 * 冒煙測試：整條路徑真的通。
 *
 * 這兩條看起來很淺，卻是整套 e2e 裡最便宜的守門員。已經發生過一次「四個指令
 * （lint / typecheck / test / build）全綠，但畫面全白」——原因是 `@ledger/shared`
 * 以 CommonJS 的樣子被丟給瀏覽器，載入失敗。那類問題只有真的開瀏覽器才看得到。
 */

// 每個測試都從乾淨的資料庫開始，否則第二次跑會撞到上次註冊的同一個 email。
test.beforeEach(async () => {
  await resetDb();
});

/**
 * 為什麼打未登入的 `/` 就足以守住白屏那件事：`app/routes.tsx` 用的是靜態匯入，
 * 沒有 lazy loading，所以首頁一載入就會把整張模組圖拉進瀏覽器，包含
 * `LedgerDetailPage → role-labels → @ledger/shared` 這條——`LEDGER_ROLES` 是
 * **值**不是型別，會留在編譯後的程式碼裡。shared 載不進來，這一頁就白。
 */
test('未登入的首頁載得起來，而且沒有未攔截的例外', async ({ page }) => {
  // 瀏覽器裡拋出的錯誤不會讓 page.goto() 失敗，必須自己收集。
  // 少了這一段，「畫面白掉但骨架還在」這種狀況可能會矇混過關。
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  // 站名是全站唯一的 h1（見 app/AppHeader.tsx）。
  await expect(page.getByRole('heading', { level: 1, name: '記帳系統' })).toBeVisible();

  // 未登入時首頁顯示訪客面板，裡面是登入 / 註冊兩個入口。
  await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '註冊', exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

/**
 * 這一條才真的跨了行程：帳號由 API 建立，登入由**瀏覽器**發出請求。
 *
 * 它守的是 CORS 與 API 位址這一類設定——瀏覽器擋掉請求時，前端程式碼一行都沒錯，
 * 但畫面就是登不進去。mock 掉 `fetch` 的元件測試永遠看不到這件事。
 */
test('用 API 建好的帳號可以從畫面登入', async ({ page, request }) => {
  const email = 'smoke@example.com';
  const password = 'sup3rsecret';

  const registered = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { email, password, name: 'Smoke' },
  });
  expect(registered.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: '登入', exact: true }).click();

  // 限定在彈窗裡找，否則「登入」會同時對到背景那顆按鈕。
  const dialog = page.getByRole('dialog', { name: '登入' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('密碼').fill(password);
  await dialog.getByRole('button', { name: '登入' }).click();

  // 登入成功後彈窗關閉，頁首換成已登入的導覽。
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
});
