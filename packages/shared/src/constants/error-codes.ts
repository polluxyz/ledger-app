/**
 * API 回傳的、穩定且機器可讀的錯誤代碼。
 *
 * 客戶端應以這些代碼分支判斷，而非依賴人類可讀的 `message`——後者僅供參考、
 * 可能隨時變動。這也是未來 i18n 的擴充點：前端把代碼對應到在地化字串。
 *
 * 功能專屬的代碼（帳本成員、交易……）會隨著各模組開發，陸續加到這裡。
 */
export const ErrorCode = {
  /** 請求 body／query 未通過 DTO 驗證。 */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 未認證，或憑證／token 無效。 */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 登入失敗：email 或密碼錯誤（絕不說明是哪一個）。 */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 已認證，但無權執行此動作。 */
  FORBIDDEN: 'FORBIDDEN',
  /** 資源不存在，或呼叫者本就不該知道它存在。 */
  NOT_FOUND: 'NOT_FOUND',
  /** 請求與目前狀態衝突（重複、破壞不變量）。 */
  CONFLICT: 'CONFLICT',
  /** 註冊時用了已被占用的 email。 */
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  /** 以某 email 加入成員，但沒有已註冊的使用者用該 email。 */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** 該使用者已是此帳本的成員。 */
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  /** 此動作會讓帳本失去所有 owner。 */
  LAST_OWNER_CANNOT_LEAVE: 'LAST_OWNER_CANNOT_LEAVE',
  /** 非 owner 試圖移除或修改其他成員。 */
  CANNOT_MANAGE_OTHER_MEMBER: 'CANNOT_MANAGE_OTHER_MEMBER',
  /** 同帳本、同型別下已存在同名分類。 */
  CATEGORY_NAME_TAKEN: 'CATEGORY_NAME_TAKEN',
  /** 仍有交易引用該分類時，不可刪除。 */
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  /** 所選分類的型別與交易型別不符。 */
  CATEGORY_TYPE_MISMATCH: 'CATEGORY_TYPE_MISMATCH',
  /** 同一使用者下已存在同名帳戶。 */
  ACCOUNT_NAME_TAKEN: 'ACCOUNT_NAME_TAKEN',
  /** 仍有交易引用該帳戶時，不可刪除（含已軟刪除的交易，歷史須可追溯）。 */
  ACCOUNT_IN_USE: 'ACCOUNT_IN_USE',
  /** 在「與帳戶連動」的帳本記帳時，未指定帳戶。 */
  ACCOUNT_REQUIRED: 'ACCOUNT_REQUIRED',
  /** 在「不與帳戶連動」的帳本記帳時，卻指定了帳戶。 */
  ACCOUNT_NOT_ALLOWED: 'ACCOUNT_NOT_ALLOWED',
  /** 轉帳的轉出與轉入是同一個帳戶。 */
  TRANSFER_SAME_ACCOUNT: 'TRANSFER_SAME_ACCOUNT',
  /** 帳本已封存，僅可讀取，不可再寫入。 */
  LEDGER_ARCHIVED: 'LEDGER_ARCHIVED',
  /** 帳本內有其他成員記下的交易，因此不可刪除（請改用封存）。 */
  LEDGER_HAS_OTHERS_TRANSACTIONS: 'LEDGER_HAS_OTHERS_TRANSACTIONS',
  /** 帳本的「是否與帳戶連動」建立後不可變更。 */
  TRACKS_BALANCE_IMMUTABLE: 'TRACKS_BALANCE_IMMUTABLE',
  /** 帳本的「私人 / 共享」建立後不可變更。 */
  LEDGER_KIND_IMMUTABLE: 'LEDGER_KIND_IMMUTABLE',
  /** 私人帳本不得加入成員。想共享請另建一本共享帳本。 */
  PERSONAL_LEDGER_CANNOT_SHARE: 'PERSONAL_LEDGER_CANNOT_SHARE',
  /** 邀請自己，或接受自己產生的邀請連結。 */
  CANNOT_FRIEND_SELF: 'CANNOT_FRIEND_SELF',
  /** 對方已經是好友。 */
  ALREADY_FRIENDS: 'ALREADY_FRIENDS',
  /** 已經有一筆送給同一個人、尚未回應的邀請。 */
  FRIEND_REQUEST_PENDING: 'FRIEND_REQUEST_PENDING',
  /** 邀請已被接受、拒絕或取消，不能再改變狀態。 */
  FRIEND_REQUEST_NOT_PENDING: 'FRIEND_REQUEST_NOT_PENDING',
  /**
   * 邀請連結無效：不存在、已使用、已過期，或已被同一人產生的新連結取代。
   * 四種情況刻意不區分——補救方法都一樣（請對方重新產生）。
   */
  INVITE_LINK_INVALID: 'INVITE_LINK_INVALID',
  /** 同一位使用者已有同名的往來對象（名字去掉前後空白後比對）。 */
  COUNTERPARTY_NAME_TAKEN: 'COUNTERPARTY_NAME_TAKEN',
  /** 往來對象還有未刪除的往來紀錄，不能刪除。 */
  COUNTERPARTY_HAS_ENTRIES: 'COUNTERPARTY_HAS_ENTRIES',
  /** 對方目前沒有欠我（往來餘額 ≤ 0），沒有東西可以免除。 */
  NOTHING_TO_FORGIVE: 'NOTHING_TO_FORGIVE',
  /** 往來餘額為 0，沒有欠款可以還。 */
  NOTHING_TO_REPAY: 'NOTHING_TO_REPAY',
  /** 還款超過目前欠款、又沒有勾以此結清；寫入會讓欠款方向反過來。 */
  REPAYMENT_EXCEEDS_BALANCE: 'REPAYMENT_EXCEEDS_BALANCE',
  /** 結清差額與免除是系統算出的調整紀錄，不能改金額；要調整就刪除後重記。 */
  DEBT_ENTRY_NOT_EDITABLE: 'DEBT_ENTRY_NOT_EDITABLE',
  /** 由往來紀錄產生的交易（借還交易、代付支出）只能從往來帳端點修改或刪除。 */
  DEBT_TRANSACTION_READ_ONLY: 'DEBT_TRANSACTION_READ_ONLY',
  /** 帳本內有往來紀錄產生的交易，不能真刪（請改用封存）。 */
  LEDGER_HAS_DEBT_TRANSACTIONS: 'LEDGER_HAS_DEBT_TRANSACTIONS',
  /** 這兩位使用者已經連動，或這個對象已經連到別人（3b-2 決策 57）。 */
  ALREADY_LINKED: 'ALREADY_LINKED',
  /** 這個對象正在連動中：不能刪除，也不能再接到另一個人（決策 57、72）。 */
  COUNTERPARTY_LINKED: 'COUNTERPARTY_LINKED',
  /** 對方已經對你發出連動邀請，請直接接受（決策 61）。 */
  LINK_INVITE_FROM_THEM: 'LINK_INVITE_FROM_THEM',
  /** 這個提議已經被接受、拒絕或作廢。 */
  PROPOSAL_NOT_PENDING: 'PROPOSAL_NOT_PENDING',
  /** 請求過於頻繁（被限流）。 */
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** 非預期的伺服器端錯誤；細節絕不外洩給客戶端。 */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** API 回傳的每個錯誤回應的統一形狀。 */
export interface ApiErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  /** 欄位層級的錯誤訊息；僅在驗證失敗時出現。 */
  details?: string[];
}
