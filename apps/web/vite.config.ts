/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite 設定：開發伺服器、建置，以及 Vitest（測試沿用同一份設定，不必另立檔案）。
 */
export default defineConfig({
  plugins: [react()],
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
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
