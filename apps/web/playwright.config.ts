import { defineConfig, devices } from '@playwright/test';
import {
  API_BASE_URL,
  API_PORT,
  API_READY_URL,
  WEB_ORIGIN,
  WEB_PORT,
  loadTestEnv,
  requireEnv,
} from './e2e/env';

/**
 * Playwright 設定：端對端測試（真的開瀏覽器、真的打後端）。
 *
 * 這一層要補的洞是元件測試補不到的——`src` 底下的測試全部 mock 掉 `fetch`，
 * 只要問題出在「兩個行程之間」（CORS、bundle 載不進瀏覽器）就一個都抓不到。
 * 相關決策見 `docs/specs/phase-2e-web-e2e.md`。
 */

/**
 * 在這裡就載入 `.env.test`，而不是等到 globalSetup。
 * 下面的 `webServer.env` 在設定檔被讀取的當下就要拿到 `DATABASE_URL` 與
 * `JWT_SECRET`，那時 globalSetup 還沒跑。
 */
loadTestEnv();

export default defineConfig({
  testDir: './e2e',

  /** 跑 migration，讓測試資料庫的 schema 與 Prisma schema 一致。 */
  globalSetup: './e2e/global-setup.ts',

  /**
   * 序列執行（D4）。所有測試共用同一個資料庫，而每個測試開始前要清空它。
   * 平行跑必定互相汙染——後面的測試會把前面正在用的資料清掉。
   */
  workers: 1,
  fullyParallel: false,

  /**
   * 不重試（D8）。重試會把不穩定的測試藏起來，變成「偶爾紅一次，重跑就好」。
   * 這個專案規模小，不穩定就當成 bug 修掉。
   */
  retries: 0,

  /** CI 上不允許 `test.only` 漏出去，否則會整批測試只跑一條還顯示綠燈。 */
  forbidOnly: !!process.env.CI,

  /** 單一測試的上限。開瀏覽器加上真實 HTTP 往返，比元件測試慢得多。 */
  timeout: 30_000,
  expect: { timeout: 10_000 },

  /**
   * list：終端機看得到每條測試的即時結果。
   * html：產出 `playwright-report/`，CI 失敗時當證據上傳。
   * `open: 'never'` 很重要——預設會在失敗時自動開瀏覽器，在 CI 或非互動環境會卡住。
   */
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    /** 測試裡寫 `page.goto('/')` 就會接到這個位址。 */
    baseURL: WEB_ORIGIN,

    /** 失敗才留證據。全開會讓每次跑都吐出一堆檔案。 */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  /** 只跑 Chromium（D5）。跨瀏覽器差異是另一個議題，成本乘三、換到的資訊有限。 */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Playwright 會自己啟動兩個伺服器，等它們就緒才開始測，結束時自動關掉。
   * 開發者不必先手動開任何東西（SC-E1）。
   */
  webServer: [
    {
      /**
       * 用 `start`（`nest start`，會先編譯）而不是 `start:prod`（`node dist/main`）。
       * 後者要求先跑過 `pnpm build`，本機忘記就會拿到過期的產物，是很難認的坑。
       * 代價是每次多編譯一次 api，約十幾秒。
       */
      command: 'pnpm --filter @ledger/api start',
      url: API_READY_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: requireEnv('DATABASE_URL'),
        JWT_SECRET: requireEnv('JWT_SECRET'),
        PORT: String(API_PORT),
        /**
         * 前端跑在另一個埠，屬不同來源。少了這一行，瀏覽器會擋掉每一個請求——
         * 這正是本專案發生過的第一次事故。
         */
        CORS_ORIGIN: WEB_ORIGIN,
        /** 停用限流，否則密集打 auth 端點會被擋（與 api 現有 e2e 一致）。 */
        NODE_ENV: 'test',
      },
    },
    {
      command: `pnpm --filter @ledger/web dev --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      /**
       * Vite 首次啟動要預先打包相依，可能超過預設的 60 秒，CI 上第一次尤其慢。
       */
      timeout: 120_000,
      /**
       * 本機重跑時沿用已經起來的伺服器，快很多；CI 一律重開，避免沿用到
       * 上一個 job 留下的殘骸。
       */
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        /** 讓前端打測試用的 API，而不是預設的 3000。 */
        VITE_API_BASE_URL: API_BASE_URL,
      },
    },
  ],
});
