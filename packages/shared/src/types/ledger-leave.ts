import type { Cents } from '../money';
import type { CategoryIcon } from '../constants/category-icons';

/**
 * 退出共享帳本並合併（階段三 3k）的 request／response 型別。規格見
 * `docs/specs/phase-3k-leave-and-merge.md` §4。
 *
 * 退出＝從我這邊刪除這本帳本（決策 189）。退出前把跟我有關的帳合併到我的另一本帳本，
 * 帳戶餘額不變、統計只算我的份額、沒結清的錢轉成個人借還。所有數字都由後端算，
 * 預覽與執行共用同一個計畫函式；前端只排版（spec §7 Never）。
 */

/**
 * `POST /ledgers/{ledgerId}/leave-preview` 與 `POST /ledgers/{ledgerId}/leave` 的 body。
 *
 * 預覽與執行送同一份內容；執行時 `deleteLedger` 為真才需要 `confirm`。
 *
 * 刪除私人帳本（3l）也用這組型別：私人帳本只有我一個人，「刪除私人帳本」等於 3k 的
 * 「最後一個人刪除共享帳本」（3l 決策 216）。兩種帳本帶的欄位不同，由後端依帳本種類檢查：
 *
 * - 共享帳本：必帶 `targetLedgerId`、`excludedItemIds`，不能帶 `moves`（照 3k）。
 * - 私人帳本：必帶 `deleteLedger: true` 與 `moves`，不能帶 `targetLedgerId`、`excludedItemIds`。
 *
 * 私人帳本的搬移**不是合併**：交易照原樣改屬目標帳本，不建新的一筆、不標來源（3l 決策 210）。
 */
export interface LeaveRequest {
  /** 合併到哪一本（決策 201）。沒有要合併的項目（全部取消勾選）時可以是 `null`。只用於共享帳本。 */
  targetLedgerId?: string | null;
  /** 取消勾選的項目，值是 `LedgerLeaveItem.id`。不屬於預覽項目的 id 回 400。只用於共享帳本。 */
  excludedItemIds?: string[];
  /** 最後一個人刪除共享帳本（決策 204）：先合併，再刪除帳本。私人帳本一律為真。 */
  deleteLedger?: boolean;
  /** `deleteLedger` 時必須等於帳本名稱，防手滑；只有執行時檢查。 */
  confirm?: string;
  /**
   * 私人帳本刪除時的搬移（3l 決策 209）：每組是「一本目標帳本＋要搬過去的項目」。不在任何一組的
   * 項目＝不搬，跟著帳本刪掉。空陣列＝全部不搬。只用於私人帳本。
   */
  moves?: LeaveMove[];
}

/**
 * 私人帳本刪除時的一組搬移（3l §4.1）。以下都回 400：同一個項目出現在兩組、同一本目標帳本出現
 * 兩次（畫面上選過的帳本不能再選，W195）、`itemIds` 是空的、項目 id 不屬於這次預覽、目標是要刪的這本。
 */
export interface LeaveMove {
  /** 搬到哪一本（3l 決策 212）：我能記帳、沒封存的帳本，私人或共享都可以。 */
  targetLedgerId: string;
  /** 這組要搬的項目，值是 `LedgerLeaveItem.id`。至少 1 個。 */
  itemIds: string[];
}

/**
 * 預覽裡的一個項目的來源：
 *
 * - `SHARED`：一般交易。共享帳本是付款、分帳、結清、我自己的帳戶互轉；私人帳本（3l）是一般收支、
 *   帳戶互轉、之前合併進來的交易（合併來的「我付、有分帳」兩筆算一項，id 是份額那一筆）。
 *   值沿用 3k 的名字：3l 規定預覽回應的形狀不變。
 * - `PERSONAL_DEBT`：我在這本帳本記的個人借還（3b），合併時改屬目標帳本（決策 197）。
 * - `PERSONAL_SPLIT`：我在這本帳本記的個人分帳（3c），同上。
 */
export const LEDGER_LEAVE_ITEM_KINDS = ['SHARED', 'PERSONAL_DEBT', 'PERSONAL_SPLIT'] as const;
export type LedgerLeaveItemKind = (typeof LEDGER_LEAVE_ITEM_KINDS)[number];

/** 預覽裡一筆可以勾選的項目（選擇交易畫面的一列，W189）。 */
export interface LedgerLeaveItem {
  /** 原交易 id；個人分帳用分帳 id。`excludedItemIds` 用的就是這個值。 */
  id: string;
  /** 原交易的日期（ISO 8601）。 */
  date: string;
  title: string | null;
  categoryIcon: CategoryIcon | null;
  /** 這筆對我各帳戶的加減（單位：分，正數＝錢進來）。別人付的是空陣列。 */
  accountEffects: LedgerLeaveAccountEffect[];
  /** 我的份額（算統計的部分）。結清、互轉、我的個人借還沒有份額，為 `null`。 */
  share: Cents | null;
  /** 別人付時的付款人顯示名稱（畫面寫「小華付」）；我付或我的個人借還為 `null`。 */
  paidByName: string | null;
  kind: LedgerLeaveItemKind;
}

export interface LedgerLeaveAccountEffect {
  accountId: string;
  name: string;
  /** 單位：分；正數＝錢進到這個帳戶。 */
  delta: Cents;
}

/** 退出後餘額會變的帳戶（只列會變的，W188）。 */
export interface LedgerLeaveAccountImpact {
  accountId: string;
  name: string;
  /** 現在的餘額。 */
  balance: Cents;
  /** 退出後的餘額。 */
  balanceAfter: Cents;
}

/**
 * 沒結清的錢轉成個人借還（決策 198）：每個人一筆「帳本轉入」。不動帳戶、不送給對方確認，
 * 跟勾不勾交易無關。
 */
export interface LedgerLeaveCarryOver {
  ledgerPersonId: string;
  displayName: string;
  /** 單位：分；正數＝對方欠我，負數＝我欠對方（同 `Counterparty.balance`）。 */
  amount: Cents;
  /** 會記到哪個對象；`null`＝會新增同名對象（名稱被用過時加「（帳本名）」）。 */
  counterpartyId: string | null;
}

/** 沒勾而撤銷的個人借還，對各對象往來餘額的影響（照 3j 決策 186 撤銷）。 */
export interface LedgerLeaveWithdrawal {
  counterpartyId: string;
  displayName: string;
  /** 連動中：撤銷會送給對方確認。 */
  linked: boolean;
  /** 現在的往來餘額，正數＝對方欠我。 */
  balance: Cents;
  balanceAfter: Cents;
}

/** 預覽說不能退出（或不能刪除）的原因（spec §4.1）。 */
export const LEDGER_LEAVE_BLOCKERS = [
  'LEDGER_ARCHIVED',
  'LAST_OWNER',
  'HAS_OTHER_MEMBERS',
  'HAS_OTHERS_TRANSACTIONS',
] as const;
export type LedgerLeaveBlocker = (typeof LEDGER_LEAVE_BLOCKERS)[number];

/**
 * `POST /ledgers/{ledgerId}/leave-preview` 的回應。只含呼叫者自己的帳戶與對象。
 *
 * 帶 `deleteLedger: true` 時是「最後一個人刪除帳本」的預覽，`blockedBy` 會多判斷
 * `HAS_OTHER_MEMBERS` 與 `HAS_OTHERS_TRANSACTIONS`。
 *
 * 私人帳本（3l §4.1）：`items` 是全部項目，前端自己濾掉已經在某一組的；`accounts`、`withdrawals`
 * 只算沒搬的（等於刪除後的結果）；`carryOvers` 恆為空陣列（私人帳本沒有帳本裡的人）。
 */
export interface LedgerLeavePreview {
  items: LedgerLeaveItem[];
  /** 只列餘額會變的帳戶；全部合併時通常是空陣列。 */
  accounts: LedgerLeaveAccountImpact[];
  carryOvers: LedgerLeaveCarryOver[];
  /** 沒勾的個人借還；只列往來餘額會變的對象。 */
  withdrawals: LedgerLeaveWithdrawal[];
  leave: {
    allowed: boolean;
    /** `allowed` 為真時是 `null`。 */
    blockedBy: LedgerLeaveBlocker | null;
  };
}

/**
 * 交易回應的 `merge`：這筆是退出共享帳本時合併來的（3k 決策 196、W191）。
 * 只有合併者本人看得到；不是合併來的為 `null`。
 *
 * 「我付、有分帳」在資料庫是兩筆（份額＋代墊），交易列表由後端合成一列：`amount` 是合計、
 * `share` 是我的份額，展開時顯示「我的份額」「代墊」兩行。其他合併來的交易 `share` 為 `null`。
 */
export interface TransactionMerge {
  /** 退出當下來源帳本的名稱（來源帳本之後可能被刪掉）。 */
  sourceLedgerName: string;
  /** 我的份額，單位：分；只有合成一列的「我付、有分帳」有值。 */
  share: Cents | null;
}
