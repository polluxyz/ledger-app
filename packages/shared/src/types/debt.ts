/**
 * 借還帳（階段三 3b）的 request／response 型別。規格見 `docs/specs/phase-3b-debts.md`。
 *
 * 一筆債務**永遠只屬於一位擁有者**，是「我借出了／我借入了」的個人記錄（spec 決策 15）。
 * 未清餘額與狀態都是**算出來的**，不存在資料庫（決策 5）。
 */

/**
 * 從擁有者的角度看，這筆債務的方向。與 Prisma 的 `DebtDirection` enum 對應。
 *
 * - `LENT`：我借出，我是債權人。還款產生 `COLLECT` 交易（錢進來）。
 * - `BORROWED`：我借入，我是債務人。還款產生 `REPAY` 交易（錢出去）。
 */
export const DEBT_DIRECTIONS = ['LENT', 'BORROWED'] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

/**
 * 債務的狀態，由本金、還款與是否免除算出（spec §3.2）。
 *
 * - `OPEN`：未免除，且未清餘額 > 0。
 * - `SETTLED`：未免除，且未清餘額 = 0。
 * - `FORGIVEN`：已免除。
 */
export const DEBT_STATUSES = ['OPEN', 'SETTLED', 'FORGIVEN'] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

/**
 * 要不要為這筆本金或還款產生一筆交易，以及記在哪裡。
 *
 * 規則與一般交易相同：帳本要有 EDITOR 以上權限且未封存；連動帳本（`tracksBalance`）
 * 必填 `accountId`，非連動帳本不可填；帳戶必須屬於呼叫者。
 */
export interface DebtRecordTarget {
  ledgerId: string;
  accountId?: string;
}

/** 一筆還款。 */
export interface DebtPayment {
  id: string;
  /** 最小貨幣單位，> 0。 */
  amount: number;
  /** ISO 8601。 */
  date: string;
  note: string | null;
  /** 對應的 `COLLECT` / `REPAY` 交易；沒有產生交易時為 `null`。 */
  transactionId: string | null;
  /** 「以此結清」的還款（決策 30）：記下它之後債務就是 `SETTLED`，金額可以不等於當時的未清餘額。 */
  settles: boolean;
  /** ISO 8601。 */
  createdAt: string;
}

/** API 回傳的債務形狀。3b-2 會再加上連動資訊。 */
export interface Debt {
  id: string;
  direction: DebtDirection;
  /** 對方的名字。 */
  counterpartyName: string;
  /** 本金，最小貨幣單位，> 0。 */
  principal: number;
  /** 借出或借入的日期，ISO 8601。 */
  date: string;
  note: string | null;
  /**
   * 本金減去所有還款。已免除時照樣回傳這個數字，是否還要收由 `status` 判斷。
   * 以結清還款結清時一律為 0，差額看 `settlementDifference`。
   */
  outstanding: number;
  status: DebtStatus;
  /**
   * 以結清還款結清時，實收付與本金的差額（決策 30）；其餘情況為 `null`。
   *
   * 正負號**從擁有者的角度**看：正數＝對我有利（借出時多收、借入時少付），負數＝對我不利。
   */
  settlementDifference: number | null;
  /** 本金那筆 `LEND` / `BORROW` 交易；舊債沒有交易時為 `null`。 */
  transactionId: string | null;
  /** 依日期由舊到新。 */
  payments: DebtPayment[];
  /** 免除的時間；未免除為 `null`。ISO 8601。 */
  forgivenAt: string | null;
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/** `POST /debts` 的 body。 */
export interface CreateDebtRequest {
  direction: DebtDirection;
  /** 1～100 字。 */
  counterpartyName: string;
  /** 正整數。 */
  principal: number;
  /** ISO 8601。 */
  date: string;
  note?: string;
  /** 省略時不產生交易：適用於系統上線前就存在的舊債（決策 7）。 */
  record?: DebtRecordTarget;
}

/**
 * `PATCH /debts/{id}` 的 body。只有送出的欄位會被更新。
 *
 * 改 `principal` 或 `date` 時，本金那筆交易（若有）一起改。`principal` 不得小於已還總額。
 */
export interface UpdateDebtRequest {
  counterpartyName?: string;
  principal?: number;
  date?: string;
  /** 送 `null` 清除備註。 */
  note?: string | null;
}

/** `POST /debts/{id}/payments` 的 body。 */
export interface CreateDebtPaymentRequest {
  /** 正整數。沒勾 `settles` 時不得超過當下的未清餘額。 */
  amount: number;
  /** ISO 8601。 */
  date: string;
  note?: string;
  /**
   * 這筆還款記到哪裡：
   *
   * - 省略：沿用本金那筆交易的帳本與帳戶；本金沒有交易時就不產生交易。
   * - `null`：明確不產生交易（例如錢沒有經過任何帳戶）。
   *
   * 交易型別不能指定：`LENT` 一律 `COLLECT`，`BORROWED` 一律 `REPAY`。
   */
  record?: DebtRecordTarget | null;
  /** 以此結清（決策 30）。`true` 時金額可以少於或多於未清餘額，這筆之後債務就結清。 */
  settles?: boolean;
}

/** `GET /debts` 的查詢參數。 */
export interface ListDebtsQuery {
  status?: DebtStatus;
  page?: number;
  limit?: number;
}

/** 每人淨額的一列（spec §5.4）。 */
export interface DebtSummaryItem {
  counterpartyName: string;
  /** 3b-1 一律為 `null`；3b-2 的連動債務才有值。 */
  counterpartyUserId: string | null;
  /** 正數：對方欠我；負數：我欠對方。只計 `OPEN` 的債務。 */
  net: number;
}

/** `GET /debts/summary` 的回應。 */
export interface DebtSummary {
  items: DebtSummaryItem[];
}
