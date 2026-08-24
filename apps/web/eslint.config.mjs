// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // v7 起 flat config 收在 configs.flat 之下（頂層同名者仍是舊的 eslintrc 格式）。
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      // 前端跑在瀏覽器；測試檔另有 vitest 的全域變數（globals: true）。
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  /**
   * e2e 測試與 Playwright 設定檔跑在 **Node**，不是瀏覽器。少了這個區塊，
   * `process.env` 會被判成未定義的變數——上面那個區塊只掛了瀏覽器的全域變數。
   */
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 這些檔案不是 React 元件，「一個檔案只匯出元件」的規則不適用。
      'react-refresh/only-export-components': 'off',
      /*
       * Playwright 的 fixture 長成 `async ({ page }, use) => { await use(x); }`。
       * 那個 `use` 是 Playwright 的回呼參數，不是 React 19 的 `use()` hook，
       * 但 react-hooks 只看名字就報錯。e2e 目錄裡沒有任何 React 程式碼。
       */
      'react-hooks/rules-of-hooks': 'off',
      /*
       * 同樣是 Playwright 的寫法：不需要任何內建 fixture 時寫成 `async ({}, use)`，
       * 那個空物件是必要的位置參數，不是疏漏。
       */
      'no-empty-pattern': 'off',
    },
  },
);
