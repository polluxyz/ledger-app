/**
 * 使用者在某帳本中的角色。與 Prisma 的 `LedgerRole` enum 對應。宣告成 const
 * tuple，好讓這組值也能重用於執行期驗證（例如 class-validator 的 @IsIn）。
 */
export const LEDGER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

/**
 * 帳本是給自己記的，還是要與別人共用。與 Prisma 的 `LedgerKind` enum 對應，
 * 同樣宣告成 const tuple 好重用於執行期驗證。
 *
 * - `PERSONAL`：只有自己。**不得加入成員。**
 * - `SHARED`：與他人共用。即使其他人都退出、只剩一位成員，它仍然是共享帳本。
 *
 * **建立後不可變更。** 想把私人帳本改成共享，請另建一本——轉換會讓「這本帳本誰
 * 看得到」在事後改變，而使用者未必察覺。也因為共享帳本可能只有一位成員，這件事
 * **無法從成員數推導**，必須是一個真正的欄位。
 */
export const LEDGER_KINDS = ['PERSONAL', 'SHARED'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** 每種帳本回應形狀都共用的核心欄位。 */
export interface Ledger {
  id: string;
  name: string;
  /** ISO 4217 幣別代碼（階段一：一律 TWD）。 */
  currency: string;
  /** 私人或共享。**建立後不可變更**；詳見 `LEDGER_KINDS` 的說明。 */
  kind: LedgerKind;
  /**
   * 這本帳本的交易是否計入我的帳戶餘額。**建立後不可變更**（事後改會讓餘額突然跳動）。
   *
   * - `true`（預設）：一般的個人／家庭帳本，記帳同時扣減對應帳戶。交易必須指定帳戶。
   * - `false`：臨時性、「錢不是我的」的帳本，例如出遊分帳、社團公款。交易不指定
   *   帳戶，也不影響任何餘額。
   */
  tracksBalance: boolean;
  /**
   * 封存時間；未封存為 `null`。封存後帳本轉為唯讀（不可再記帳），且預設不出現在
   * 帳本列表中。
   *
   * 之所以用封存取代刪除：共享帳本一旦被別人刪掉，你先前記在裡面的交易也會消失，
   * 你的帳戶餘額就被「回溯性」改變了——那是不可接受的。
   */
  archivedAt: string | null;
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

/** GET /ledgers 的查詢參數。 */
export interface ListLedgersQuery {
  /** 是否一併列出已封存的帳本（預設 false）。 */
  includeArchived?: boolean;
}

/** POST /ledgers 的請求 body。 */
export interface CreateLedgerRequest {
  name: string;
  /**
   * 私人或共享，**省略時為 `PERSONAL`**。建立後就定案，之後不可更改。
   *
   * 選 `SHARED` 時可以先不加任何成員——對方也許還沒註冊，不該因此卡住建立。
   */
  kind?: LedgerKind;
  /** 是否與我的帳戶餘額連動（預設 true）。**建立後就定案，之後不可更改。** */
  tracksBalance?: boolean;
}

/**
 * PATCH /ledgers/{ledgerId} 的請求 body。
 *
 * 只有名稱可改。`tracksBalance` 與 `kind` 刻意**不在**這裡——兩者建立後即定案。
 * 後端仍會明確接住它們並回 400（`TRACKS_BALANCE_IMMUTABLE` / `LEDGER_KIND_IMMUTABLE`），
 * 好讓誤送的人得到說得出原因的錯誤訊息，而不是一句籠統的「欄位不被允許」。
 */
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
