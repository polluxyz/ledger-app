import type { Cents } from '../money';
import type { SplitMethod, SplitPrecision } from './split';
import type { Transaction } from './transaction';

/**
 * 共享帳本的分帳與結清（階段三 3e）的 request／response 型別。規格見
 * `docs/specs/phase-3e-shared-split.md`。
 *
 * 這套帳跟 3c 的個人分帳（`types/split.ts`）完全分開：3c 以「我的對象」表示人、只給擁有者看；
 * 3e 以「帳本裡的人」（`LedgerPerson`）表示人，帳本的全部成員看到同一份。
 * 份額、淨額與結清建議一律由後端算（`computeSharesByKey`、`computeLedgerNets`、
 * `suggestSettlements`），前端只能顯示。金額一律是「分」。
 */

/** 帳本裡的人的狀態：`MEMBER` 現任成員、`LEFT` 已離開的成員、`GUEST` 非成員（決策 136）。 */
export const LEDGER_PERSON_STATUSES = ['MEMBER', 'LEFT', 'GUEST'] as const;
export type LedgerPersonStatus = (typeof LEDGER_PERSON_STATUSES)[number];

/** 共享帳本裡可以分帳的一個人（§5.1）。 */
export interface LedgerPerson {
  id: string;
  /** 成員取 `User.name`；非成員是建立時給的名字。 */
  name: string;
  /** 有帳號的成員（含已離開）才有；非成員為 `null`。 */
  userId: string | null;
  status: LedgerPersonStatus;
}

/** `POST /ledgers/{ledgerId}/people` 的 body：新增虛擬成員（3f W140 起改稱「虛擬成員」）。 */
export interface CreateLedgerPersonRequest {
  /** 1～50 字，同一本帳本的虛擬成員之間不能重複。 */
  name: string;
  /**
   * 選填（3f §4.3）：建立的同時替呼叫者把這個虛擬成員指向我的這個對象，在同一個資料庫交易。
   * 別人的對象回 404。
   */
  counterpartyId?: string;
}

/** `PATCH /ledgers/{ledgerId}/people/{id}` 的 body：虛擬成員改名。成員那一筆不能改（400）。 */
export interface UpdateLedgerPersonRequest {
  name: string;
}

/** 名單裡的一個人（請求）。 */
export interface LedgerShareInput {
  /** 這本帳本的 `LedgerPerson.id`。別本帳本的 id 回 404。 */
  personId: string;
  /** `AMOUNT` 必填（分），其他分法不可帶。 */
  amount?: Cents;
  /** `RATIO` 必填（萬分比，0～10000），其他分法不可帶。 */
  ratio?: number;
}

/**
 * 交易 `POST`／`PATCH` 的 `ledgerSplit` 欄位（§5.2）。只有共享帳本的 `EXPENSE`／`INCOME` 可帶。
 * 名單是**整份取代**；`PATCH` 傳 `null` 拿掉名單（不分帳，決策 120）。
 */
export interface LedgerSplitInput {
  method: SplitMethod;
  /** 預設 `CENT`；`AMOUNT` 不可帶。 */
  precision?: SplitPrecision;
  shares: LedgerShareInput[];
}

/** 名單裡的一個人（回應）。 */
export interface LedgerShareView {
  person: LedgerPerson;
  /** 份額，分，> 0。 */
  share: Cents;
  /** `RATIO` 才有值（萬分比）。 */
  ratio: number | null;
}

/** 交易回應的 `ledgerSplit`：帳本全部成員都看得到，依建立時的順序。 */
export interface LedgerSplitView {
  method: SplitMethod;
  precision: SplitPrecision;
  shares: LedgerShareView[];
}

/** 交易回應的 `settlement`：這筆 `TRANSFER` 是一筆結清（決策 128）。 */
export interface TransactionSettlementRef {
  id: string;
  from: LedgerPerson;
  to: LedgerPerson;
}

/** `GET /ledgers/{ledgerId}/settlement-summary` 的一位：淨額＋＝別人欠他、−＝他欠別人。 */
export interface SettlementSummaryPerson {
  person: LedgerPerson;
  net: Cents;
}

/** 一條結清建議：`fromPersonId` 付 `amount` 給 `toPersonId`（§3.3）。 */
export interface SettlementSuggestion {
  fromPersonId: string;
  toPersonId: string;
  /** 分，> 0。 */
  amount: Cents;
}

/** `GET /ledgers/{ledgerId}/settlement-summary` 的回應。 */
export interface SettlementSummary {
  /** 依「帳本裡的人」的建立順序；淨額 0 的也列，含已離開的成員與沒用到的非成員。 */
  people: SettlementSummaryPerson[];
  suggestions: SettlementSuggestion[];
}

/**
 * `POST /ledgers/{ledgerId}/settlements` 的 body（決策 129）。
 *
 * 帳戶規則：只有「我」那一邊能帶帳戶；連動帳本裡我那一邊必填。別的成員那一邊留空（帳戶待補），
 * 非成員那一邊永遠空。替別人帶帳戶回 `400 ACCOUNT_NOT_PAYERS`。
 */
export interface CreateSettlementRequest {
  /** 付錢的人；省略＝我。 */
  fromPersonId?: string;
  /** 收錢的人，不能跟付錢的人相同（`400 SETTLEMENT_SAME_PERSON`）。 */
  toPersonId: string;
  /** 分，> 0，≤ `MAX_AMOUNT_CENTS`。 */
  amount: Cents;
  /** ISO 8601。 */
  date: string;
  /** 最多 500 字。 */
  note?: string;
  /** 只有付錢的人是我時能帶；連動帳本裡這時必填。 */
  fromAccountId?: string;
  /** 只有收錢的人是我時能帶；連動帳本裡這時必填。 */
  toAccountId?: string;
}

/**
 * `PATCH /ledgers/{ledgerId}/settlements/{id}` 的 body：只更新送出的欄位。
 * 付錢或收錢的人一換，那一邊的帳戶就清空（同決策 125）；換成我時要在同一次帶我的帳戶。
 */
export type UpdateSettlementRequest = Partial<CreateSettlementRequest>;

/** 結清端點的回應：就是那筆 `TRANSFER` 交易（`settlement` 有值）。 */
export type SettlementResponse = Transaction;

/**
 * 補帳戶（帳戶待補，決策 124）：
 * `PUT /ledgers/{ledgerId}/transactions/{id}/account` 與 `PUT /ledgers/{ledgerId}/settlements/{id}/account`。
 *
 * 只有付款人（結清時是付錢或收錢的那一位）本人能補，角色是 VIEWER 也可以；帳戶必須屬於呼叫者。
 * 這是 VIEWER 唯一能做的寫入，所以另開端點，不放寬 `PATCH` 的 EDITOR 門檻（plan §3 第 1 列）。
 */
export interface SetAccountRequest {
  accountId: string;
}

/** 補帳戶的回應：更新後的交易。 */
export type SetAccountResponse = Transaction;
