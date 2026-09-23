/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';

/**
 * 在**建置產物**的 `index.html` 注入 Content Security Policy（SEC-4，見
 * `docs/specs/security-baseline.md`）。
 *
 * 為什麼是建置時的插件、而不是直接寫進 `index.html`：開發伺服器的 HMR 靠
 * inline script 運作，頁面若一開始就帶 `script-src 'self'`，熱更新注入的
 * 腳本會被瀏覽器擋掉，`pnpm dev` 直接壞掉。`apply: 'build'` 讓這條政策只在
 * `vite build` 時生效，dev 完全不受影響——守著這條界線的測試在
 * `e2e/csp.spec.ts`，它打的是 `vite preview` 的靜態產物，不是 dev server。
 *
 * CSP 在這個專案的定位是「token 存 localStorage」的補償措施：擋住 XSS 的
 * 執行面，token 才不容易被偷走。它不是 token 不會外洩的保證。
 */
function cspMetaPlugin(): Plugin {
  // configResolved 一定先於 transformIndexHtml 執行，政策在那時組好備用。
  let policy = '';

  return {
    name: 'inject-content-security-policy',
    apply: 'build',
    configResolved(config) {
      // loadEnv 與前端程式碼讀 `import.meta.env` 看到的是同一套值：process.env
      // 加上 .env 檔。connect-src 是「建置時」決定的，所以建置環境必須帶對
      // VITE_API_BASE_URL——e2e 的 preview webServer 為此在 build 時就指向
      // 測試 API（3100），而不是開發用的 3000。
      const env = loadEnv(config.mode, config.envDir ?? config.root, 'VITE_');
      // 與 `src/lib/api-client.ts` 的預設值一致；來源不同就各建各的。
      const baseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
      // 只取 origin：CSP 管的是來源，不認路徑，`/api` 前綴留在 CSP 之外。
      const apiOrigin = new URL(baseUrl).origin;

      policy = [
        "default-src 'self'",
        // 絕不加 'unsafe-inline'——加了等於把這整件事取消掉。
        "script-src 'self'",
        // 目前建置產物只有一個外部 .css、沒有 inline style，所以不必放寬。
        // 哪天真的被擋，先看違規訊息原文再決定對策，不要預先投降。
        "style-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self' ${apiOrigin}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
    },
    transformIndexHtml() {
      // 用 tags API 而不是字串替換，並插在 <head> 最前面：CSP 的 meta 標籤
      // 只對出現在它「之後」的內容生效，愈早出現愈好。
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

/**
 * Vite 設定：開發伺服器、建置，以及 Vitest（測試沿用同一份設定，不必另立檔案）。
 */
export default defineConfig({
  plugins: [react(), cspMetaPlugin()],
  optimizeDeps: {
    /**
     * `@ledger/shared` 編譯成 CommonJS（`main: dist/index.js`，內容是 `require`
     * 與 `exports`）。它是 workspace 連結的套件，而 Vite **預設不預先打包連結的
     * 套件**——會把原始檔案直接丟給瀏覽器。瀏覽器把 CommonJS 當 ES module 載入
     * 就會失敗，整個 app 掛不起來，畫面全白。
     *
     * 列在這裡就會被預先打包成 ESM，web 因此可以匯入 shared 的**值**
     * （`LEDGER_ROLES`、`ErrorCode` 這類常數），而不只是型別。
     *
     * 為什麼不是讓 shared 改出 ESM：它是 private 套件，三個消費者
     * （NestJS、Vite、未來的 Metro）都吃得下 CommonJS。雙進入點換來的是雙份
     * 產物與 dual-package hazard，成本比解決的問題大。重評的觸發條件是
     * 「shared 要發佈到 npm」或「出現吃不了 CJS 的消費者」。
     *
     * ⚠️ 改了 `packages/shared` 並重新 build 之後，開發伺服器要重開才會拿到新的
     * 預先打包結果。
     */
    include: ['@ledger/shared'],
  },
  test: {
    // 元件測試需要 DOM；jsdom 在 Node 內模擬瀏覽器環境。
    environment: 'jsdom',
    /**
     * 把 e2e 排除在 Vitest 之外。
     *
     * Vitest 預設會撿走整個專案裡所有 `*.spec.ts`，其中包含 Playwright 的
     * `e2e/*.spec.ts`——但那些檔案匯入的 `test` 是 Playwright 的，不是
     * Vitest 的，撿到就直接爆掉。
     *
     * 兩者刻意分開跑：`pnpm test` 只跑元件測試（快、不需要伺服器），
     * e2e 走 `pnpm test:e2e`（要起兩個伺服器與資料庫）。
     */
    exclude: [...configDefaults.exclude, 'e2e/**'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
