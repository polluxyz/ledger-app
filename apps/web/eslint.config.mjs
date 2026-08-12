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
);
