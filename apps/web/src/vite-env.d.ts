/// <reference types="vite/client" />

/**
 * 宣告本專案用到的環境變數，讓 `import.meta.env` 有型別可循
 * （否則存取結果是 any，會被 lint 擋下）。新增 VITE_ 變數時同步補在這裡，
 * 並更新 .env.example。
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
