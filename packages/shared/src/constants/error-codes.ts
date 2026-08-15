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
