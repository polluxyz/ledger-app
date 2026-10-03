import type { Cents } from '../money';
import type { DebtEntrySyncStatus } from './debt';
import type { Transaction, TransactionRef } from './transaction';

/**
 * 代墊與分帳（階段三 3c）的 request／response 型別。規格見 `docs/specs/phase-3c-split.md`。
 *
 * 一筆**分帳**是「一筆有別人份的支出或收入」：存總額、付款人、分法與整份名單（決策 87）。
 * 它在帳上拆成多筆交易與往來紀錄（決策 86、§3.5），所以統計直接加總支出型別就對；
 * 個人角度只有牽涉到我的那幾份會進我的往來帳。
 *
 * 金額一律是「分」。份額由後端用 `computeSplitShares` 算好存下，前端只能預覽。
 */

/** 分帳的類型：支出或收入（決策 85，規則對稱）。 */
export const SPLIT_TYPES = ['EXPENSE', 'INCOME'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

/** 分法（決策 90）：均分、自訂金額、自訂比例（萬分比）。 */
export const SPLIT_METHODS = ['EQUAL', 'AMOUNT', 'RATIO'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/**
 * 精度（決策 91）：均分與比例算不盡時，其他人四捨五入到「分」或「元」，吸收者拿剩下的。
 * 自訂金額不取整，不可帶。
 */
export const SPLIT_PRECISIONS = ['CENT', 'YUAN'] as const;
export type SplitPrecision = (typeof SPLIT_PRECISIONS)[number];

/** 名單裡的一個人（請求）。 */
export interface SplitParticipantInput {
  /** 我的對象；`null`＝我。 */
  counterpartyId: string | null;
  /** `AMOUNT` 必填（分），其他分法不可帶。 */
  amount?: Cents;
  /** `RATIO` 必填（萬分比，0～10000，見 `SPLIT_RATIO_TOTAL`），其他分法不可帶。 */
  ratio?: number;
}

/**
 * `POST /splits` 與 `PATCH /splits/{id}` 的 body。PATCH 是**整份取代**，所有欄位都要帶。
 *
 * - `payer: null`＝我付（收）。我付且帳本連動時 `accountId` 必填；其他情況不可帶。
 * - 別人付時名單必須有我（`400 SPLIT_WITHOUT_ME`）；我付時名單必須有我以外的人
 *   （`400 SPLIT_NOT_NEEDED`）。PATCH 例外：結果是「我付、只有我」時分帳解散成一般交易（決策 105）。
 */
export interface CreateSplitRequest {
  type: SplitType;
  ledgerId: string;
  categoryId: string;
  /** 總額，分，> 0，≤ `MAX_AMOUNT_CENTS`。 */
  total: Cents;
  /** ISO 8601。 */
  date: string;
  /** 最多 100 字。 */
  title?: string;
  /** 最多 500 字。 */
  note?: string;
  payer: { counterpartyId: string } | null;
  accountId?: string;
  method: SplitMethod;
  /** 預設 `CENT`；`AMOUNT` 不可帶。 */
  precision?: SplitPrecision;
  participants: SplitParticipantInput[];
  /**
   * 只有 POST：把這筆一般交易轉成分帳，原交易在同一個資料庫交易裡軟刪除（決策 105）。
   * 必須是呼叫者記的 `EXPENSE`／`INCOME`、型別與 `type` 相同、不屬於分帳或往來，
   * 否則 `409 TRANSACTION_NOT_CONVERTIBLE`。
   */
  fromTransactionId?: string;
}

/** `PATCH /splits/{id}` 的 body：同建立，但沒有 `fromTransactionId`。 */
export type UpdateSplitRequest = Omit<CreateSplitRequest, 'fromTransactionId'>;

/** 名單裡的一個人（回應）。 */
export interface SplitParticipant {
  /** `null`＝我。 */
  counterpartyId: string | null;
  /** 對象的顯示名稱（同 `Counterparty.displayName`）；我是 `null`，由前端顯示。 */
  name: string | null;
  /** 份額，分，> 0。 */
  share: Cents;
  /** `RATIO` 才有值（萬分比）。 */
  ratio: number | null;
  /**
   * 這個人對應的往來紀錄。我付時是名單裡每個別人各一筆；別人付時只有付款人那一筆
   * （掛在付款人身上，即使付款人不在名單裡也一樣，見 `Split.payerEntryId`）。其餘為 `null`。
   */
  entryId: string | null;
  /** 那筆往來紀錄與對方的同步狀態；沒有往來紀錄時為 `null`。 */
  sync: DebtEntrySyncStatus | null;
}

/** API 回傳的分帳。只回給擁有者。 */
export interface Split {
  id: string;
  type: SplitType;
  ledgerId: string;
  category: TransactionRef;
  total: Cents;
  /** ISO 8601。 */
  date: string;
  title: string | null;
  note: string | null;
  /** `null`＝我付（收）。 */
  payer: { counterpartyId: string; name: string } | null;
  /**
   * 別人付時，我欠付款人（或付款人欠我）的那筆往來紀錄。付款人不一定在名單裡，
   * 所以單獨列出。我付時為 `null`。
   */
  payerEntryId: string | null;
  account: TransactionRef | null;
  method: SplitMethod;
  precision: SplitPrecision;
  /** 整份名單，依建立時的順序（決策 87）。畫面依決策 87 只顯示牽涉到我的部分。 */
  participants: SplitParticipant[];
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/**
 * `PATCH /splits/{id}` 的回應。一般情況回新的分帳、`transaction` 為 `null`；
 * 改成「我付、只有我」時分帳解散，`split` 為 `null`、`transaction` 是留下的那筆一般交易。
 */
export interface UpdateSplitResponse {
  split: Split | null;
  transaction: Transaction | null;
}

/**
 * 交易列表展開分帳所需的資料（3c §5.2），掛在 `Transaction.split`。只回給分帳的擁有者。
 * 一次帶齊，展開時不必再打 `GET /splits/{id}`。
 */
export interface TransactionSplitRef {
  id: string;
  type: SplitType;
  /** 總額（分）。我付時列表顯示這個。 */
  total: Cents;
  /** 我那份（分）；我不在名單裡時為 0。別人付時列表顯示這個。 */
  myShare: Cents;
  /** `null`＝我付（收）。 */
  payer: { counterpartyId: string; name: string } | null;
  /**
   * 只有牽涉到我的人（決策 87）：我付時是名單裡的每個別人；別人付時只有付款人。
   * `direction` 是錢該往哪流，畫面用箭頭表示（§7 第 5 點）。
   */
  counterparts: TransactionSplitCounterpart[];
}

export const SPLIT_DIRECTIONS = ['THEY_OWE_ME', 'I_OWE_THEM'] as const;
export type SplitDirection = (typeof SPLIT_DIRECTIONS)[number];

export interface TransactionSplitCounterpart {
  counterpartyId: string;
  name: string;
  /** 分。 */
  amount: Cents;
  direction: SplitDirection;
  sync: DebtEntrySyncStatus;
}
