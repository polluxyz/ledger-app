/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** `@ledger/shared` 的建置產物，也就是被預先打包的那一份。 */
const sharedDistDir = fileURLToPath(new URL('../../packages/shared/dist', import.meta.url));

/** 把目錄裡所有檔案的相對路徑與內容雜湊成一個短字串；目錄不存在時回 `missing`。 */
function hashDirectory(dir: string): string {
  if (!existsSync(dir)) return 'missing';
  const hash = createHash('sha256');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(dir, file)).isFile())
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * `packages/shared` 重新 build 之後，讓 dev server 自動丟掉舊的預先打包結果。
 *
 * Vite 只在「lockfile 或 optimizeDeps 設定變了」時重做預先打包，不看連結套件的
 * 內容。shared 改了、`node_modules/.vite` 卻還是舊的，畫面就會出現
 * 「xxx is not a function」或整頁黑掉。以前的對策是手動刪 `.vite`，這個插件取代它：
 *
 * 1. **啟動時**：把 shared `dist` 的雜湊塞進 `optimizeDeps` 的 define。這個值是
 *    Vite 快取雜湊的一部分，dist 一變，Vite 就自己判定快取過期並重做。用不到的
 *    全域常數不會進任何程式碼，只是拿來當快取鍵。
 * 2. **執行中**：監看 dist，有變動就重開 dev server。重開會重新讀設定，回到第 1 點；
 *    瀏覽器連回來時會自動整頁重新載入。
 *
 * 只在 dev server 生效：`vite build` 每次都從頭打包，沒有快取問題；Vitest 不用
 * 預先打包，也不該因為 shared 重 build 而重開。
 */
function sharedPrebundleRefreshPlugin(): Plugin {
  return {
    name: 'refresh-shared-prebundle',
    apply: (_config, { command }) => command === 'serve' && !process.env.VITEST,
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            transform: {
              define: { __LEDGER_SHARED_DIST_HASH__: JSON.stringify(hashDirectory(sharedDistDir)) },
            },
          },
        },
      };
    },
    configureServer(server) {
      server.watcher.add(sharedDistDir);
      // tsc 一次會寫好幾個檔，等它寫完再重開一次就好。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onSharedDistChange = (file: string) => {
        const pathInDist = relative(sharedDistDir, file);
        if (pathInDist.startsWith('..') || isAbsolute(pathInDist)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          server.config.logger.info('packages/shared 已重新 build，重開 dev server 以更新預先打包');
          void server.restart();
        }, 500);
      };
      server.watcher.on('add', onSharedDistChange);
      server.watcher.on('change', onSharedDistChange);
      server.watcher.on('unlink', onSharedDistChange);
    },
  };
}

/**
 * Vite 設定：開發伺服器、建置，以及 Vitest（測試沿用同一份設定，不必另立檔案）。
 */
export default defineConfig({
  plugins: [react(), cspMetaPlugin(), sharedPrebundleRefreshPlugin()],
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
     * 改了 `packages/shared` 並重新 build 之後，預先打包結果由
     * `sharedPrebundleRefreshPlugin` 自動更新。
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
    /**
     * Vitest 預設把所有 `.css` 換成空字串（連 `?raw` 也是），元件測試不需要樣式。
     * 唯一的例外是 `global.css`：`styles/tokens.test.ts` 要讀它的原始文字，
     * 驗淺色 token 兩塊相同與每一組對比都及格（phase-2h D15）。
     */
    css: { include: [/global\.css/] },
    setupFiles: ['./src/test/setup.ts'],
  },
});
