import type { Cents } from '../money';
import type { LedgerPerson } from './ledger-split';

/**
 * 共享帳本的人併入對象頁與借還（階段三 3f）的 request／response 型別。規格見
 * `docs/specs/phase-3f-unified-debts.md` §4。
 *
 * 「指向」是我自己的設定：把帳本裡的某個人對到我已建立的對象（決策 146）。只有我讀得到、
 * 不通知對方、不是連動。金額、合併、分組一律由後端算，前端只能顯示（spec §7）。
 */

/**
 * `PUT /ledgers/{ledgerId}/people/{personId}/pointer` 的 body。
 * `null`＝明確「不指向」，蓋過自動指向（決策 148）。要回到自動指向用 `DELETE`。
 */
export interface SetLedgerPointerRequest {
  counterpartyId: string | null;
}

/**
 * 某個帳本裡的人目前的有效指向。
 *
 * - `auto: true`：沒有明確設定，套用自動指向（他的帳號＝我某個連動對象的帳號）；
 *   沒有符合的連動對象時 `counterpartyId` 為 `null`。
 * - `auto: false`：我明確設定過；`counterpartyId` 為 `null` 代表選了「不指向」。
 */
export interface LedgerPointer {
  counterpartyId: string | null;
  auto: boolean;
}

/** `PUT`／`DELETE …/pointer` 的回應：設定後的有效指向。 */
export type LedgerPointerResponse = LedgerPointer;

/** `GET /ledger-groups` 的一個人（W130、W135）。 */
export interface LedgerGroupPerson {
  person: LedgerPerson;
  /** 我跟他之間的結清轉帳（決策 142）。正數＝他欠我、負數＝我欠他、0＝沒有轉帳。 */
  amount: Cents;
  pointer: LedgerPointer;
}

/**
 * `GET /ledger-groups` 的一組：我參與過的一本共享帳本。
 *
 * 列出規則（W130）：只列我現在是成員的帳本（3k 決策 189），人包含現任成員與虛擬成員，
 * 已離開的成員只在 `amount ≠ 0` 時列。
 * 我自己那一筆永遠不列。依帳本名稱排序，組內依「帳本裡的人」的建立順序。
 */
export interface LedgerGroup {
  ledger: {
    id: string;
    name: string;
  };
  people: LedgerGroupPerson[];
  /**
   * 這本帳本裡我看得到的已記結清筆數（3g W161）。只有帶 `hasSettlements=true` 時回；
   * 已退出的帳本只算我是任一方的結清。
   */
  settlementCount?: number;
}

/** `GET /ledger-groups` 的查詢參數。 */
export interface ListLedgerGroupsQuery {
  /**
   * `true`（借還頁，W135）：只回沒指向（有效指向為 `null`）且 `amount ≠ 0` 的人；
   * 整組沒有人時那組不回。
   */
  unpointed?: boolean;
  /**
   * `true`（借還 › 歷史，3g W161）：只回有我看得到的已記結清的帳本（含已退出的帳本，不受
   * 上面「已退出只在還有轉帳時列」的限制），每組帶 `settlementCount`。`people` 照上面的規則。
   */
  hasSettlements?: boolean;
}
