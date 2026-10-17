import type { Cents } from '../money';

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
  /** 已退出的人（`left: true`）一律是空陣列，看不到成員（3f 決策 151）。 */
  members: LedgerMemberInfo[];
  /**
   * 呼叫者已退出這本帳本（3f §4.4）。這時帳本只能唯讀：交易列表只回跟呼叫者有關的帳，
   * 其他帳本端點回 404，寫入回 409 `LEDGER_LEFT`。現任成員一律 `false`。
   */
  left: boolean;
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
}

/**
 * PATCH /ledgers/{ledgerId} 的請求 body。
 *
 * 只有名稱可改。`kind` 刻意**不在**這裡——它建立後即定案。後端仍會明確接住它並回 400
 * （`LEDGER_KIND_IMMUTABLE`），好讓誤送的人得到說得出原因的錯誤訊息。
 *
 * 3h 起沒有「不計入餘額」的帳本（決策 165）：所有帳本的交易都算進帳戶餘額，
 * `tracksBalance` 已從請求與回應拿掉，帶了一律 400。
 */
export interface UpdateLedgerRequest {
  name: string;
}

/**
 * POST /ledgers/{ledgerId}/members 的請求 body，兩種擇一：
 *
 * - `{ email, role }`：以 email 加入已註冊的使用者。
 * - `{ counterpartyId, role }`（3f §4.3）：用我已連動的對象加入，後端取連動的帳號，
 *   前端拿不到對方 email。對象沒連動回 400 `COUNTERPARTY_NOT_LINKED`，別人的對象回 404。
 */
export type AddMemberRequest = AddMemberByEmailRequest | AddMemberByCounterpartyRequest;

export interface AddMemberByEmailRequest {
  email: string;
  role: LedgerRole;
}

export interface AddMemberByCounterpartyRequest {
  counterpartyId: string;
  role: LedgerRole;
}

/** PATCH /ledgers/{ledgerId}/members/{userId} 的請求 body：變更成員角色。 */
export interface UpdateMemberRequest {
  role: LedgerRole;
}

/** 預覽說不能刪的原因（3j §4.2）。 */
export const LEDGER_DELETE_BLOCKERS = [
  'LEDGER_ARCHIVED',
  'HAS_OTHERS_TRANSACTIONS',
  'SHARED_HAS_DEBTS',
] as const;
export type LedgerDeleteBlocker = (typeof LEDGER_DELETE_BLOCKERS)[number];

/**
 * GET /ledgers/{ledgerId}/removal-preview 的回應（3j 決策 188）：刪除這本帳本後，
 * 呼叫者自己的帳戶與往來對象的餘額會變成多少。只有擁有者能查。
 *
 * 數字全部由後端算，與實際刪除用同一套規則；前端只排版。只含呼叫者自己的帳戶與對象。
 * 不能刪時 `accounts`、`counterparties` 是空陣列，畫面只顯示原因。
 */
export interface LedgerRemovalPreview {
  /** 只列餘額會變的帳戶。 */
  accounts: LedgerRemovalAccountImpact[];
  /** 只列刪除後餘額會變的對象（我在這本帳本有借還或分帳，且淨影響不是 0）。 */
  counterparties: LedgerRemovalCounterpartyImpact[];
  /**
   * 刪除時會撤銷我在這本帳本的借還與分帳（3j 決策 186，只有私人帳本）。為真時
   * `DELETE /ledgers/{ledgerId}` 要帶 `withdrawDebts=true`，否則回 409 `DEBT_WITHDRAWAL_REQUIRED`。
   */
  withdrawsDebts: boolean;
  delete: {
    allowed: boolean;
    /** `allowed` 為真時是 `null`。 */
    blockedBy: LedgerDeleteBlocker | null;
  };
}

export interface LedgerRemovalAccountImpact {
  accountId: string;
  name: string;
  /** 現在的餘額。 */
  balance: Cents;
  /** 刪除後的餘額。 */
  balanceAfter: Cents;
}

export interface LedgerRemovalCounterpartyImpact {
  counterpartyId: string;
  displayName: string;
  /** 連動中：撤銷會送給對方確認。 */
  linked: boolean;
  /** 現在的往來餘額，正數＝對方欠我（同 `Counterparty.balance`）。 */
  balance: Cents;
  balanceAfter: Cents;
}

/** DELETE /ledgers/{ledgerId} 的查詢參數。 */
export interface DeleteLedgerQuery {
  /** 必須等於帳本名稱，防手滑。 */
  confirm: string;
  /** 同意撤銷我在這本帳本的借還與分帳（3j 決策 186）。 */
  withdrawDebts?: boolean;
}
