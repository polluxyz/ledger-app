import { LEDGER_ROLES, type LedgerRole } from '@ledger/shared';

/**
 * 角色的中文標籤。
 *
 * 獨立一個檔案是因為它同時被 `MemberList` 與帳本明細頁使用，而元件檔不能同時
 * 匯出元件與常數（react-refresh 的 lint 規則）。
 *
 * 標籤留在 web 而不放 shared：它是呈現，不是契約。後端不需要知道 `OWNER` 的中文
 * 叫什麼，未來要 i18n 也是前端的事。
 */
export const ROLE_LABEL: Record<LedgerRole, string> = {
  OWNER: '擁有者',
  EDITOR: '可編輯',
  VIEWER: '唯讀',
};

/**
 * 下拉選單的角色順序，直接沿用 shared 的 `LEDGER_ROLES`（由權限大到小）。
 *
 * 這裡匯入的是**值**不是型別。web 一度做不到這件事——shared 是 CommonJS，而 Vite
 * 預設不預先打包 workspace 連結的套件，瀏覽器載入時會失敗、畫面全白。
 * `apps/web/vite.config.ts` 的 `optimizeDeps.include` 就是為此而設。
 */
export const ROLE_OPTIONS = LEDGER_ROLES;
