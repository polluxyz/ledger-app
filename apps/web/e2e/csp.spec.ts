import { expect, test } from '@playwright/test';
import {
  createTransaction,
  listAccounts,
  listCategories,
  personalLedger,
  registerUser,
  TEST_PASSWORD,
} from './api';
import { PREVIEW_ORIGIN } from './env';
import { transactionRow } from './ui';

/**
 * CSP（Content Security Policy）的 e2e：政策由 `vite.config.ts` 的插件注入
 * **建置產物**，所以這個檔全部打在 `vite preview`（PREVIEW_ORIGIN），不是
 * dev server（WEB_ORIGIN）——dev 上根本沒有這條政策，拿它測等於沒測。
 *
 * 驗證分三層：政策真的在頁面裡、整個 app 在政策下活得下去（登入、讀資料，
 * 全程 console 沒有任何 CSP 違規）、政策的確擋得下不該執行的東西（inline
 * script）。對應 security baseline 的 SEC-4 驗證條件。
 *
 * 刻意不用 `fixtures.ts` 的清資料庫機制：帳號用獨一無二的 email，資料可見性
 * 由後端的資料隔離保證，與資料庫裡殘留什麼無關。代價是單獨重跑此檔不會清掉
 * 上次的帳號，所以 email 帶時間戳，避免第二次註冊撞 409。
 */

/** 時間戳保證唯一：這個檔沒有清資料庫的前置，固定 email 會在重跑時撞 409。 */
const email = `csp-${Date.now()}@example.com`;

test('建置產物的頁面帶 CSP 的 meta 標籤', async ({ page }) => {
  await page.goto(PREVIEW_ORIGIN);

  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveCount(1);

  // 只釘住最不能讓步的幾項，其餘驗「存在」：整串政策含 connect-src 的 API
  // origin，會隨建置環境的 VITE_API_BASE_URL 變動，逐字比對會把不同環境的
  // 合法建置判成失敗。
  const content = (await meta.getAttribute('content')) ?? '';
  expect(content).toContain("script-src 'self'");
  expect(content).toContain('connect-src');
  expect(content).not.toContain('unsafe-inline');
});

test('在 CSP 之下登入並讀得到資料，過程沒有任何 CSP 違規', async ({ page, request }) => {
  // 前置資料走 API（D3）：被測的是「頁面在 CSP 下讀得到資料」，不是怎麼記第一筆帳。
  const user = await registerUser(request, email, 'CSP');
  const ledger = await personalLedger(request, user.token);
  const [cash] = await listAccounts(request, user.token);
  const categories = await listCategories(request, user.token, ledger.id);
  const expense = categories.find((category) => category.type === 'EXPENSE');
  await createTransaction(request, user.token, ledger.id, {
    type: 'EXPENSE',
    amount: 120,
    date: new Date().toISOString(),
    categoryId: expense!.id,
    accountId: cash!.id,
    note: 'CSP 探針',
  });

  // 瀏覽器把 CSP 違規寫進 console，訊息含 "Content Security Policy"。在導航前
  // 就掛上監聽，連第一個請求的違規都跑不掉。
  const consoleTexts: string[] = [];
  page.on('console', (message) => consoleTexts.push(message.text()));

  await page.goto(PREVIEW_ORIGIN);
  await page.getByRole('button', { name: '登入', exact: true }).click();

  // 限定在彈窗裡找，否則「登入」會同時對到背景那顆按鈕（與 smoke.spec.ts 同）。
  const dialog = page.getByRole('dialog', { name: '登入' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('密碼').fill(TEST_PASSWORD);
  await dialog.getByRole('button', { name: '登入' }).click();

  // 登入打 /auth/login，成功後畫面接著拉帳本、帳戶、分類、交易——任何一個被
  // connect-src 擋掉，這兩行就等不到。這條是 connect-src 的照妖鏡：漏了 API
  // origin，當場紅。
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await expect(transactionRow(page, '-$120')).toContainText('CSP 探針');

  const violations = consoleTexts.filter((text) => text.includes('Content Security Policy'));
  expect(violations, `出現 CSP 違規：${violations.join('｜')}`).toEqual([]);
});

test('inline script 被 CSP 擋下', async ({ page }) => {
  await page.goto(PREVIEW_ORIGIN);

  // 驗的是「執行面」：把一段 inline <script> 塞進文件，它若跑起來會設定
  // window.__cspProbe。
  //
  // CSP 擋下時 `addScriptTag` 會**拋錯**而不是安靜失敗（Playwright 等不到腳本
  // 載入完成），所以這裡斷言它被 reject，而且理由就是那條政策。只斷言
  // __cspProbe 是 undefined 並不夠——測試自己先炸掉了，根本走不到那一行。
  await expect(page.addScriptTag({ content: 'window.__cspProbe = "executed";' })).rejects.toThrow(
    /Content Security Policy/,
  );

  // 再確認一次那段程式碼真的沒有留下痕跡：被擋的意思是「沒有執行」，
  // 不是「執行了但被忽略」。
  const probe = await page.evaluate(() => (window as { __cspProbe?: string }).__cspProbe);
  expect(probe).toBeUndefined();
});
