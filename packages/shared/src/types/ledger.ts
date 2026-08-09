/**
 * 使用者在某帳本中的角色。與 Prisma 的 `LedgerRole` enum 對應。宣告成 const
 * tuple，好讓這組值也能重用於執行期驗證（例如 class-validator 的 @IsIn）。
 */
export const LEDGER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

/** 每種帳本回應形狀都共用的核心欄位。 */
export interface Ledger {
  id: string;
  name: string;
  /** ISO 4217 幣別代碼（階段一：一律 TWD）。 */
  currency: string;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** 帳本＋請求者在其中的角色（列表端點使用）。 */
export interface LedgerSummary extends Ledger {
  role: LedgerRole;
}

/** 帳本的一位成員，附帶足以顯示的使用者資訊。 */
export interface LedgerMemberInfo {
  userId: string;
  email: string;
  name: string;
  role: LedgerRole;
}

/** 帳本＋其完整成員清單（帳本明細端點）。 */
export interface LedgerDetail extends Ledger {
  members: LedgerMemberInfo[];
}

/** POST /ledgers 的請求 body。 */
export interface CreateLedgerRequest {
  name: string;
}

/** PATCH /ledgers/{ledgerId} 的請求 body。 */
export interface UpdateLedgerRequest {
  name: string;
}

/** POST /ledgers/{ledgerId}/members 的請求 body：以 email 加入已註冊的使用者。 */
export interface AddMemberRequest {
  email: string;
  role: LedgerRole;
}

/** PATCH /ledgers/{ledgerId}/members/{userId} 的請求 body：變更成員角色。 */
export interface UpdateMemberRequest {
  role: LedgerRole;
}
