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
 * 8 種往來紀錄（spec §3.2）。前 5 種由使用者記；`SETTLEMENT`、`FORGIVE`、`FORGIVEN` 是
 * 系統算出的調整紀錄，不產生交易、不能改金額（決策 38～40）。
 *
 * `FORGIVEN`（被免除）只會在連動後出現：對方免除我的欠款、我接受時寫入（3b-2 §3.2）。
 */
export const DEBT_ENTRY_KINDS = [
  'LEND',
  'BORROW',
  'COLLECT',
  'REPAY',
  'PAID_FOR_ME',
  'SETTLEMENT',
  'FORGIVE',
  'FORGIVEN',
] as const;
export type DebtEntryKind = (typeof DEBT_ENTRY_KINDS)[number];

/**
 * `POST /debt-entries` 接受的種類（修訂 1，決策 46、49）。
 *
 * 還款只有一種 `REPAYMENT`：後端依寫入當下的往來餘額，存成 `COLLECT`（對方還我）或
 * `REPAY`（我還對方）。方向是業務規則，所以前端不能直接送 `COLLECT`／`REPAY`。
 * `PAID_FOR_ME` 畫面上暫時拿掉，之後與代墊一起設計；API 先保留。
 */
export const CREATE_DEBT_ENTRY_KINDS = ['LEND', 'BORROW', 'REPAYMENT', 'PAID_FOR_ME'] as const;
export type CreateDebtEntryKind = (typeof CREATE_DEBT_ENTRY_KINDS)[number];

/** 可以帶 `settle: true`（以此結清）的種類：只有還款。 */
export const SETTLEABLE_DEBT_ENTRY_KINDS = ['REPAYMENT'] as const;

/**
 * 對象連到的使用者（3b-2 決策 60）。只揭露顯示名稱與雙方共有的一個數字，不給對方的明細。
 */
export interface CounterpartyLinkInfo {
  userId: string;
  userName: string;
  /**
   * 對方帳上的往來餘額，**換成我的角度**（對方的餘額取負號）。與我的 `balance` 並排，
   * 讓雙方自行核對；兩者可能不同，因為連動前的紀錄不同步（決策 59）。
   */
  theirBalance: number;
}

/** 往來對象。 */
export interface Counterparty {
  id: string;
  /** 去掉前後空白，1～100 字。同一位使用者底下不重複。 */
  name: string;
  /** 往來餘額。正數＝對方欠我，負數＝我欠對方。 */
  balance: number;
  /** 連動中的使用者；沒有連動時為 `null`。 */
  link: CounterpartyLinkInfo | null;
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
  /** 與對方的同步狀態（3b-2 §3.4），由後端算出。 */
  sync: DebtEntrySyncStatus;
  /** 是否與對方那邊的一筆紀錄配對。畫面用它決定改或刪之前要不要警告（決策 67）。 */
  paired: boolean;
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/**
 * 一筆往來紀錄與對方的同步狀態（3b-2 §3.4）。
 *
 * - `NONE`：沒有連動、連動前記的、或不同步的種類。
 * - `PENDING`：自己送出的提議還在等對方確認。
 * - `SYNCED`：已與對方那筆配對，且沒有待確認的提議。
 * - `DECLINED`：最近一次送出的提議被對方拒絕。
 */
export const DEBT_ENTRY_SYNC_STATUSES = ['NONE', 'PENDING', 'SYNCED', 'DECLINED'] as const;
export type DebtEntrySyncStatus = (typeof DEBT_ENTRY_SYNC_STATUSES)[number];

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
  kind: CreateDebtEntryKind;
  /**
   * 正整數。`delta` 的正負號由 `kind` 決定；`REPAYMENT` 由目前餘額決定。
   * `REPAYMENT` 在往來餘額為 0 時回 409 `NOTHING_TO_REPAY`；沒帶 `settle` 又超過欠款時回
   * 409 `REPAYMENT_EXCEEDS_BALANCE`。
   */
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
  /** 以此結清（決策 38）。只有 `REPAYMENT` 可以帶；帶了就不受「不能超過欠款」限制。 */
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
  /** 只有 `GET /counterparties` 使用：名字包含這段文字（不分大小寫）。 */
  q?: string;
}

/** `POST /counterparties` 的 body：不記帳先新增一個人（3b-2 決策 55）。 */
export interface CreateCounterpartyRequest {
  name: string;
}

/** `POST /counterparties/{id}/link-invites` 的 body：用 email 邀請對方連動。 */
export interface CreateLinkInviteRequest {
  email: string;
}

/**
 * 接受連動邀請時，接受者選自己這邊要接上的對象（決策 58）：既有、未連動的對象用 `{ id }`；
 * 新建用 `{ name }`（撞名回 409 `COUNTERPARTY_NAME_TAKEN`）。
 */
export type LinkCounterpartyChoice = { id: string } | { name: string };

// ---------------------------------------------------------------------------
// 提議（3b-2 §3.3、§5.3）
// ---------------------------------------------------------------------------

/**
 * 提議種類：`CREATE` 連動後新增一筆；`AMEND` 改了已配對紀錄的金額或日期；`DELETE` 刪了已配對的紀錄。
 */
export const DEBT_PROPOSAL_TYPES = ['CREATE', 'AMEND', 'DELETE'] as const;
export type DebtProposalType = (typeof DEBT_PROPOSAL_TYPES)[number];

/** 只有 `PENDING` 能轉換；其餘三個是終點。 */
export const DEBT_PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
export type DebtProposalStatus = (typeof DEBT_PROPOSAL_STATUSES)[number];

/** 從呼叫者的角度看：別人送來的，或我送出的。 */
export const DEBT_PROPOSAL_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type DebtProposalDirection = (typeof DEBT_PROPOSAL_DIRECTIONS)[number];

/**
 * 一筆提議，**一律從呼叫者的角度呈現**（spec §5.3）。
 *
 * - 收到的：`entryKind` 換成我的角度（對方借出 → 我這邊是 `BORROW`），`otherUser` 是發起者。
 *   不含發起者的備註、帳本、帳戶，也不含他那邊的對象名字（§3.5）。
 * - 送出的：`entryKind` 是我自己那筆的種類，另帶 `sourceEntryId`。
 */
export interface DebtProposal {
  id: string;
  direction: DebtProposalDirection;
  type: DebtProposalType;
  status: DebtProposalStatus;
  /** 另一方：收到的是發起者，送出的是接受者。 */
  otherUser: { id: string; name: string };
  /** 我這邊連動的對象；解除連動後可能為 `null`。 */
  counterpartyId: string | null;
  entryKind: DebtEntryKind;
  /** 正整數。`CREATE`、`AMEND` 是提議的值；`DELETE` 是刪除當下那筆的值。 */
  amount: number;
  /** ISO 8601。 */
  date: string;
  /** 還款是否帶了以此結清。 */
  settle: boolean;
  /** 只有送出的提議才有：我自己那筆紀錄。 */
  sourceEntryId?: string;
  /**
   * 收到的 `AMEND`：**我自己那筆**被改之前的金額與日期（3b-2 web F26），讓畫面寫得出
   * 「$120 → $150」。只取接受者自己的資料，不揭露發起者的帳。我那筆已被自己刪掉時、
   * 以及其他所有提議，一律 `null`。
   */
  previous: { amount: number; date: string } | null;
  /** ISO 8601。 */
  createdAt: string;
  respondedAt: string | null;
}

/** `GET /debt-proposals` 的查詢參數。 */
export interface ListDebtProposalsQuery {
  direction: DebtProposalDirection;
  status?: DebtProposalStatus;
  page?: number;
  limit?: number;
}

/**
 * `POST /debt-proposals/{id}/accept` 的 body。
 *
 * 只有 `CREATE` 且種類是借出、借入、還款時需要 `record`（物件或 `null`，規則同
 * `POST /debt-entries`）；其他提議不可帶。
 */
export interface AcceptDebtProposalRequest {
  record?: DebtEntryRecordTarget | null;
}
