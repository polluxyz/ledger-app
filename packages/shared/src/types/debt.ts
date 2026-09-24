/**
 * 借還帳（階段三 3b，往來帳版）的 request／response 型別。規格見 `docs/specs/phase-3b-debts.md`。
 *
 * 每個**對象**一本往來帳：記帳者和對象之間的每一次借、還、代付都是一筆**往來紀錄**，
 * 往來餘額是所有未刪除紀錄的 `delta` 加總（決策 33、34）。餘額是**算出來的**，不存欄位，
 * 前端也不計算——畫面上的餘額一律取自回應。
 *
 * 正負號的慣例全檔一致：**正數＝對方欠我，負數＝我欠對方**。
 */

/**
 * 7 種往來紀錄（spec §3.2）。前 5 種由使用者記；`SETTLEMENT`、`FORGIVE` 是系統算出的
 * 調整紀錄，不產生交易、不能改金額（決策 38～40）。
 */
export const DEBT_ENTRY_KINDS = [
  'LEND',
  'BORROW',
  'COLLECT',
  'REPAY',
  'PAID_FOR_ME',
  'SETTLEMENT',
  'FORGIVE',
] as const;
export type DebtEntryKind = (typeof DEBT_ENTRY_KINDS)[number];

/** 使用者自己記的 5 種。`POST /debt-entries` 的 `kind` 只接受這些。 */
export const MANUAL_DEBT_ENTRY_KINDS = [
  'LEND',
  'BORROW',
  'COLLECT',
  'REPAY',
  'PAID_FOR_ME',
] as const;
export type ManualDebtEntryKind = (typeof MANUAL_DEBT_ENTRY_KINDS)[number];

/** 可以帶 `settle: true`（以此結清）的種類：只有還款。 */
export const SETTLEABLE_DEBT_ENTRY_KINDS = ['COLLECT', 'REPAY'] as const;

/** 往來對象。 */
export interface Counterparty {
  id: string;
  /** 去掉前後空白，1～100 字。同一位使用者底下不重複。 */
  name: string;
  /** 往來餘額。正數＝對方欠我，負數＝我欠對方。 */
  balance: number;
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/** 一筆往來紀錄。 */
export interface DebtEntry {
  id: string;
  counterpartyId: string;
  kind: DebtEntryKind;
  /** 對往來餘額的影響，有正負號，不為 0。正數＝這筆讓對方多欠我。 */
  delta: number;
  /** ISO 8601。 */
  date: string;
  note: string | null;
  /** 產生的交易；調整紀錄與「不記入帳本」為 `null`。 */
  transactionId: string | null;
  /**
   * 寫入這筆之後的累計往來餘額（依日期、再依建立時間由舊到新累加）。
   * 只在 `GET /counterparties/{id}/entries` 回傳。
   */
  balanceAfter?: number;
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/** 這筆往來要記成哪本帳本、哪個帳戶的交易。 */
export interface DebtEntryRecordTarget {
  ledgerId: string;
  /** 連動帳本必填、非連動帳本不可填；`PAID_FOR_ME` 一律不可填。 */
  accountId?: string;
}

/** `POST /debt-entries` 的 body。 */
export interface CreateDebtEntryRequest {
  /** 既有對象用 `{ id }`；新對象用 `{ name }`（名字對得上既有對象時就用那一個）。 */
  counterparty: { id: string } | { name: string };
  kind: ManualDebtEntryKind;
  /** 正整數。`delta` 的正負號由 `kind` 決定。 */
  amount: number;
  /** ISO 8601。 */
  date: string;
  note?: string;
  /**
   * **必填**：物件＝產生交易並記在這裡；`null`＝不產生交易（只記往來）。
   * `PAID_FOR_ME` 不可為 `null`（它就是要記那筆支出）。
   */
  record: DebtEntryRecordTarget | null;
  /** `PAID_FOR_ME` 必填，須為該帳本的支出分類；其他種類不可帶。 */
  categoryId?: string;
  /** 以此結清（決策 38）。只有 `COLLECT`、`REPAY` 可以帶。 */
  settle?: boolean;
}

/** `POST /debt-entries` 的回應。 */
export interface CreateDebtEntryResponse {
  /** 寫入後的對象（含新的往來餘額）。 */
  counterparty: Counterparty;
  /** 這次寫入的 1 筆，或加上結清差額的 2 筆。 */
  entries: DebtEntry[];
}

/** `PATCH /debt-entries/{id}` 的 body。只有送出的欄位會變；調整紀錄不能改。 */
export interface UpdateDebtEntryRequest {
  amount?: number;
  date?: string;
  /** 送 `null` 清除備註。 */
  note?: string | null;
}

/** `PATCH /counterparties/{id}` 的 body。 */
export interface UpdateCounterpartyRequest {
  name: string;
}

/** `GET /counterparties` 與 `GET /counterparties/{id}/entries` 的查詢參數。 */
export interface ListCounterpartiesQuery {
  page?: number;
  limit?: number;
}
