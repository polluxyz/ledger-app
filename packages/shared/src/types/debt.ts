import type { Cents } from '../money';

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
 * 11 種往來紀錄（spec §3.2）。`SETTLEMENT`、`FORGIVE`、`FORGIVEN` 是系統算出的調整紀錄，
 * 不產生交易、不能改金額（決策 38～40）。
 *
 * `FORGIVEN`（被免除）只會在連動後出現：對方免除我的欠款、我接受時寫入（3b-2 §3.2）。
 *
 * 代墊與代收（3c §3.2）的 4 種：`PAID_FOR_THEM` 我幫對方付（delta > 0，交易型別 `LEND`）、
 * `PAID_FOR_ME` 對方幫我付（delta < 0，沒有帳戶的支出）、`RECEIVED_FOR_THEM` 我幫對方收
 * （delta < 0，交易型別 `BORROW`）、`RECEIVED_FOR_ME` 對方幫我收（delta > 0，沒有帳戶的收入）。
 * 它們只能從分帳端點產生，或由接受對方的提議產生；連動的鏡像兩兩相對。
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
  'PAID_FOR_THEM',
  'RECEIVED_FOR_THEM',
  'RECEIVED_FOR_ME',
] as const;
export type DebtEntryKind = (typeof DEBT_ENTRY_KINDS)[number];

/**
 * `POST /debt-entries` 接受的種類（修訂 1，決策 46、49）。
 *
 * 還款只有一種 `REPAYMENT`：後端依寫入當下的往來餘額，存成 `COLLECT`（對方還我）或
 * `REPAY`（我還對方）。方向是業務規則，所以前端不能直接送 `COLLECT`／`REPAY`。
 *
 * `PAID_FOR_ME` 在 3c 移除（決策 107）：「對方幫我付」一律走分帳端點（`POST /splits`）。
 * 既有的 `PAID_FOR_ME` 紀錄照常顯示、修改、刪除。
 */
export const CREATE_DEBT_ENTRY_KINDS = ['LEND', 'BORROW', 'REPAYMENT'] as const;
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
   * 對方帳上的往來餘額，單位：分；**換成我的角度**（對方的餘額取負號）。與我的 `balance` 並排，
   * 讓雙方自行核對；兩者可能不同，因為連動前的紀錄不同步（決策 59）。
   */
  theirBalance: Cents;
}

/** 往來對象。 */
export interface Counterparty {
  id: string;
  /**
   * **我取的名字**（3b-2 修訂 1，決策 77）。去掉前後空白，1～100 字，同一位使用者底下不重複。
   * 未連動的對象一定有值；已連動的對象是選填的「暱稱」，沒設時為 `null`。
   */
  name: string | null;
  /**
   * 顯示用的名字，由後端算好：`name`，沒有就用連動使用者的帳號名稱。
   * 畫面上除了對象頁的「帳號名稱（暱稱）」，一律顯示這個，前端不自己判斷。
   */
  displayName: string;
  /**
   * 待詢問（決策 75）：連動成立時自動建立、還沒回答「之前有沒有用別的名字記過他」。
   * 回答「沒有」或完成合併後變 `false`。
   */
  askMerge: boolean;
  /** 往來餘額，單位：分。正數＝對方欠我，負數＝我欠對方。只含個人往來（3f 意義不變）。 */
  balance: Cents;
  /**
   * 指向這個對象的共享帳本的人，在各帳本裡跟我之間的結清轉帳（3f 決策 142）。
   * 依帳本名稱排序；金額為 0 的不列。
   */
  ledgerParts: CounterpartyLedgerPart[];
  /** `balance` ＋ `ledgerParts` 的金額加總（3f 決策 143），由後端算。 */
  totalBalance: Cents;
  /** 連動中的使用者；沒有連動時為 `null`。 */
  link: CounterpartyLinkInfo | null;
  /** ISO 8601。 */
  createdAt: string;
  updatedAt: string;
}

/**
 * 對象總額的一個帳本來源（3f §4.2）。`amount` 正數＝對方欠我、負數＝我欠對方，不為 0。
 * `left` 為 `true` 代表我已退出那本帳本：只能打開唯讀畫面，不能記結清（W139）。
 */
export interface CounterpartyLedgerPart {
  ledgerId: string;
  ledgerName: string;
  personId: string;
  personName: string;
  amount: Cents;
  left: boolean;
}

/** 一筆往來紀錄。 */
export interface DebtEntry {
  id: string;
  counterpartyId: string;
  kind: DebtEntryKind;
  /** 對往來餘額的影響，單位：分；有正負號，不為 0。正數＝這筆讓對方多欠我。 */
  delta: Cents;
  /** ISO 8601。 */
  date: string;
  note: string | null;
  /**
   * 產生的交易。免除（`FORGIVE`、`FORGIVEN`）指向它的「呆帳」或「債務免除」交易（3h 決策 162）。
   * 3h 之前的舊資料可能是 `null`：選了「不記入帳本」的紀錄、舊的免除與舊差額。
   */
  transactionId: string | null;
  /**
   * 分帳產生的紀錄（3c）指向那筆分帳；接受提議產生的與一般往來為 `null`。
   * 有值時這筆只能從分帳端點修改或刪除（`409 SPLIT_ENTRY_READ_ONLY`）。
   */
  splitId: string | null;
  /**
   * 3g 的舊資料：「以此結清」產生的差額（`SETTLEMENT`）指向它的還款（3g 決策 156）。3h 起差額改成
   * 還款底下的分支交易（見 `difference`），migration 也把對得到還款的舊差額轉掉了，所以新資料
   * 一律是 `null`。仍有值的舊紀錄照舊不能單獨撤銷（`409 SETTLEMENT_BOUND_TO_REPAYMENT`）。
   */
  settlesEntryId: string | null;
  /**
   * 「以此結清」的還款底下的分支交易（3h 決策 170～172）；其他紀錄為 `null`。有分支時，這筆還款的
   * `delta` 是還清的欠款，實際收付 = 還清的欠款 ∓ 分支（`EXPENSE` 減、`INCOME` 加）。分支不影響
   * 往來餘額，撤銷或修改還款時由後端一併處理。
   */
  difference: DebtEntryDifferenceRef | null;
  /**
   * 寫入這筆之後的累計往來餘額，單位：分（依日期、再依建立時間由舊到新累加）。
   * 只在 `GET /counterparties/{id}/entries` 回傳。
   */
  balanceAfter?: Cents;
  /**
   * 這筆產生的交易現在記在哪裡（3i §4.3）：修改對話框用它帶入目前的帳戶、名稱、分類。
   * `accountId` 一定是我自己的帳戶；呆帳、債務免除沒有帳戶，為 `null`。沒有交易的舊資料整個為 `null`。
   */
  recorded: DebtEntryRecorded | null;
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

/** 往來紀錄的交易現在的帳本、帳戶、名稱、分類（3i §4.3）。 */
export interface DebtEntryRecorded {
  ledgerId: string;
  accountId: string | null;
  title: string | null;
  categoryId: string | null;
}

/** 還款底下的結清分支（3h 決策 170）。名稱用 `differenceLabelOf` 由還款與分支的型別決定。 */
export interface DebtEntryDifferenceRef {
  transactionId: string;
  /** `EXPENSE`：少收、多付；`INCOME`：多收、少付（決策 171）。 */
  type: 'EXPENSE' | 'INCOME';
  /** 單位：分；恆為正整數。 */
  amount: Cents;
}

/** 這筆往來要記成哪本帳本、哪個帳戶的交易。 */
export interface DebtEntryRecordTarget {
  ledgerId: string;
  /**
   * 借出、借入、還款、代墊**必填**，而且不能是臨時帳戶（3h 決策 163、169）。
   * `PAID_FOR_ME`、`RECEIVED_FOR_ME` 與免除（呆帳、債務免除）不可填：錢不經過我的帳戶（決策 160、162）。
   */
  accountId?: string;
}

/** `POST /debt-entries` 的 body。 */
export interface CreateDebtEntryRequest {
  /** 既有對象用 `{ id }`；新對象用 `{ name }`（名字對得上既有對象時就用那一個）。 */
  counterparty: { id: string } | { name: string };
  kind: CreateDebtEntryKind;
  /**
   * 正整數金額，單位：分。`delta` 的正負號由 `kind` 決定；`REPAYMENT` 由目前餘額決定。
   * `REPAYMENT` 在往來餘額為 0 時回 409 `NOTHING_TO_REPAY`；沒帶 `settle` 又超過欠款時回
   * 409 `REPAYMENT_EXCEEDS_BALANCE`。
   */
  amount: Cents;
  /** ISO 8601。 */
  date: string;
  note?: string;
  /**
   * **必填**：產生交易並記在這本帳本、這個帳戶（3h 決策 163）。沒有「不記入帳本」——送 `null` 回 400。
   */
  record: DebtEntryRecordTarget;
  /** 交易名稱，選填，最多 100 字（3i 決策 181、179）。 */
  title?: string;
  /**
   * 選填，須為 `record.ledgerId` 那本帳本的分類（3i 決策 178、181）。方向看後端決定的種類
   * （`debtCategoryTypeOf`）：借出、還款（我還對方）用支出分類，借入、收回用收入分類，
   * 不符 400 `CATEGORY_TYPE_MISMATCH`，不是這本帳本的 404。只是標記，交易型別不變。
   */
  categoryId?: string;
  /**
   * 以此結清。只有 `REPAYMENT` 可以帶；帶了就不受「不能超過欠款」限制。`amount` 是實際收付的金額：
   * 還款記還清的欠款，差額記成還款底下的分支交易（3h 決策 170）。
   */
  settle?: boolean;
}

/** `POST /debt-entries` 的回應。 */
export interface CreateDebtEntryResponse {
  /** 寫入後的對象（含新的往來餘額）。 */
  counterparty: Counterparty;
  /** 這次寫入的紀錄。3h 起一律 1 筆：以此結清的差額是還款的 `difference`，不再是另一筆紀錄。 */
  entries: DebtEntry[];
}

/**
 * `POST /counterparties/{id}/forgive` 的 body（3h 決策 162、175）：免除對方欠我的剩餘金額，
 * 在這本帳本記一筆支出「呆帳」，不動帳戶。
 */
export interface ForgiveCounterpartyRequest {
  ledgerId: string;
}

/** `PATCH /debt-entries/{id}` 的 body。只有送出的欄位會變；調整紀錄不能改。 */
export interface UpdateDebtEntryRequest {
  /** 金額，單位：分。 */
  amount?: Cents;
  date?: string;
  /** 送 `null` 清除備註。 */
  note?: string | null;
  // 以下 3 個改的是這筆的交易（3i 決策 176）。已連動的紀錄只改我這邊、不送提議（決策 180）；
  // 沒有交易的舊資料帶了回 409 `DEBT_ENTRY_NOT_EDITABLE`。
  /** 交易名稱，最多 100 字；送 `null` 清除（決策 179）。 */
  title?: string | null;
  /**
   * 換到我自己的一般帳戶（決策 177）：別人的 404，臨時帳戶 400 `TEMPORARY_ACCOUNT_NOT_SELECTABLE`。
   * 還款底下的分支跟著換。
   */
  accountId?: string;
  /** 同 `CreateDebtEntryRequest.categoryId` 的規則；送 `null` 清除（決策 178）。 */
  categoryId?: string | null;
}

/**
 * `PATCH /counterparties/{id}` 的 body。`null` 只允許已連動的對象（清掉暱稱）；
 * 未連動的對象送 `null` 回 400。
 */
export interface UpdateCounterpartyRequest {
  name: string | null;
}

/** `GET /counterparties` 的查詢參數。 */
export interface ListCounterpartiesQuery {
  page?: number;
  limit?: number;
  /** 名字或連動使用者的帳號名稱包含這段文字（不分大小寫，決策 79）。 */
  q?: string;
  /** `true` 時只列待詢問的對象（總覽的待確認卡片）。 */
  askMerge?: boolean;
  /** `true` 時只列 `totalBalance ≠ 0` 的對象（借還總覽，W136）。 */
  nonZero?: boolean;
  /** `true` 時只列個人往來 `balance ≠ 0` 的對象，不看共享帳本金額（借還 › 個人，3g W157）。 */
  personalNonZero?: boolean;
  /** `true` 時只列至少有一筆已還清紀錄的對象（借還 › 歷史，3g W161、決策 153）。 */
  hasHistory?: boolean;
}

/**
 * 往來紀錄的分段（3g 決策 153，餘額歸零為界）：由新到舊找第一筆 `balanceAfter === 0` 的紀錄，
 * 那一筆與更早的是 `history`（已還清），之後的是 `outstanding`（未還清）。從沒歸零過就全部是
 * `outstanding`。分界由後端算，前端不可自己切。
 */
export const DEBT_ENTRY_SECTIONS = ['outstanding', 'history'] as const;
export type DebtEntrySection = (typeof DEBT_ENTRY_SECTIONS)[number];

/** `GET /counterparties/{id}/entries` 的查詢參數。 */
export interface ListDebtEntriesQuery {
  page?: number;
  limit?: number;
  /** 不帶時回全部紀錄（照 3g 之前的行為）。分頁套用在篩選後的結果。 */
  section?: DebtEntrySection;
}

/** `POST /counterparties` 的 body：不記帳先新增一個人（3b-2 決策 55）。 */
export interface CreateCounterpartyRequest {
  name: string;
}

/**
 * `POST /counterparties/{id}/merge` 的 body（決策 76、80）：把 `sourceId`（自己的、未連動）
 * 併進 `{id}`（自己的、已連動）。紀錄搬過去，`sourceId` 刪除；`{id}` 沒有 `name` 時改用
 * `sourceId` 的名字。條件不符回 409 `MERGE_NOT_ALLOWED`。
 */
export interface MergeCounterpartyRequest {
  sourceId: string;
}

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
  /**
   * 另一方：收到的是發起者，送出的是接受者。`name` 是**我這邊那個對象的顯示名稱**
   * （有暱稱就是暱稱，決策 81）；沒有連動的對象可對時（解除後）才是帳號名稱。
   */
  otherUser: { id: string; name: string };
  /** 我這邊連動的對象；解除連動後可能為 `null`。 */
  counterpartyId: string | null;
  entryKind: DebtEntryKind;
  /** 單位：分的正整數。`CREATE`、`AMEND` 是提議的值；`DELETE` 是刪除當下那筆的值。 */
  amount: Cents;
  /** ISO 8601。 */
  date: string;
  /** 還款是否帶了以此結清。 */
  settle: boolean;
  /**
   * 名稱（3c 決策 101）：分帳產生的紀錄帶上分帳的名稱，接受者那邊的交易預設同名。
   * 其他提議為 `null`。之後改名稱不送變更。
   */
  title: string | null;
  /** 只有送出的提議才有：我自己那筆紀錄。 */
  sourceEntryId?: string;
  /**
   * 收到的 `AMEND`：**我自己那筆**被改之前的金額（單位：分）與日期（3b-2 web F26），讓畫面寫得出
   * 「$120 → $150」。只取接受者自己的資料，不揭露發起者的帳。我那筆已被自己刪掉時、
   * 以及其他所有提議，一律 `null`。
   */
  previous: { amount: Cents; date: string } | null;
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
 * 只有 `CREATE` 需要 `record`；其他提議不可帶。依接受者那邊寫入的種類（3c 決策 102）。
 * 3h 起沒有「不記入帳本」（決策 163），`record` 一律是物件：
 *
 * | 接受者寫入                           | `record`                                  | `categoryId`                     | `title` |
 * | ------------------------------------ | ----------------------------------------- | -------------------------------- | ------- |
 * | 借入、借出、還款（3b-2）             | **物件**，帳戶必填（同 `POST /debt-entries`） | 不可帶                           | 不可帶  |
 * | `PAID_FOR_THEM`、`RECEIVED_FOR_THEM` | **物件**，帳戶必填                        | 不可帶                           | 可帶    |
 * | `PAID_FOR_ME`、`RECEIVED_FOR_ME`     | **物件**，只有 `ledgerId`、不可帶帳戶     | **必填**，該帳本的支出／收入分類 | 可帶    |
 * | `FORGIVEN`（被免除，決策 162）       | **物件**，只有 `ledgerId`、不可帶帳戶     | 不可帶                           | 不可帶  |
 *
 * 接受者沒有欠款可免除時，免除提議照樣接受、什麼都不寫，這時 `record` 可省略。
 * `title` 省略時沿用提議的 `title`；送空字串代表不要名稱。
 */
export interface AcceptDebtProposalRequest {
  record?: DebtEntryRecordTarget;
  categoryId?: string;
  title?: string;
}
