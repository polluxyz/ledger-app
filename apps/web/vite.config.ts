/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite 設定：開發伺服器、建置，以及 Vitest（測試沿用同一份設定，不必另立檔案）。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // 元件測試需要 DOM；jsdom 在 Node 內模擬瀏覽器環境。
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
