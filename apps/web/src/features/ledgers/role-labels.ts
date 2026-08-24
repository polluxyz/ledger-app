import type { LedgerRole } from '@ledger/shared';

/**
 * 角色的中文標籤。獨立一個檔案是因為它同時被 `MemberList` 與帳本明細頁使用，
 * 而元件檔不能同時匯出元件與常數（react-refresh 的 lint 規則）。
 */
export const ROLE_LABEL: Record<LedgerRole, string> = {
  OWNER: '擁有者',
  EDITOR: '可編輯',
  VIEWER: '唯讀',
};
