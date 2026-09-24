import type { ErrorCode } from '@ledger/shared';
import { ApiError } from './api-client';

/** 連不上後端（fetch 直接失敗）時的訊息。沿用 FormError 舊版的原句，只是集中管理。 */
const NETWORK_FAILURE_MESSAGE = '無法連線到伺服器，請確認網路後再試一次。';

/**
 * `errorCode` → 在地化訊息的對照表。
 *
 * 後端的錯誤訊息是英文，而介面是中文——直接原樣呈現會讓中文畫面裡冒出英文句子。
 * 這張表照 `error-codes.ts` 檔頭預留的擴充點，把代碼換成使用者看得懂的文字。
 *
 * 兩條寫作規則：
 *   1. 寫「發生什麼事、接下來該怎麼辦」，不是把英文逐字翻一遍。
 *   2. **不可以比後端更具體。** 後端沒給的事實（筆數、誰的操作）一律不寫——
 *      猜錯比英文更糟。
 *
 * 這裡只有文案，沒有任何規則判斷（前端零業務邏輯）；沒收錄的代碼由
 * `toUserMessage` 退回後端原文。
 */
export const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  // ── 驗證與認證 ───────────────────────────────────────────────────────────
  VALIDATION_FAILED: '有欄位不符合要求，請依照下方訊息修改後再送出。',
  INVALID_CREDENTIALS: 'Email 或密碼不正確，請再試一次。',
  EMAIL_ALREADY_EXISTS: '這個 email 已經註冊過了，請改用登入。',
  UNAUTHORIZED: '登入狀態已失效，請重新登入。',
  FORBIDDEN: '你沒有權限執行這個動作。',
  NOT_FOUND: '找不到這筆資料，請重新整理頁面後再試。',
  TOO_MANY_REQUESTS: '操作太頻繁了，請稍待片刻再試。',
  INTERNAL_ERROR: '發生未預期的錯誤，請稍後再試。',

  // ── 帳本與成員 ────────────────────────────────────────────────────────────
  USER_NOT_FOUND: '找不到使用這個 email 的帳號。請對方先註冊，再加入。',
  ALREADY_MEMBER: '這個人已經是這本帳本的成員，不用再加入。',
  LAST_OWNER_CANNOT_LEAVE: '你是這本帳本唯一的擁有者，先把其他成員升成擁有者才能退出。',
  CANNOT_MANAGE_OTHER_MEMBER: '只有擁有者能移除或調整其他成員。',
  PERSONAL_LEDGER_CANNOT_SHARE: '私人帳本不能加入成員。想一起記帳，請另建一本共享帳本。',
  LEDGER_ARCHIVED: '這本帳本已封存，只能查看，不能再修改。',
  LEDGER_HAS_OTHERS_TRANSACTIONS: '這本帳本還有其他成員記的交易，不能刪除。請改用封存。',

  // ── 分類 ──────────────────────────────────────────────────────────────────
  CATEGORY_NAME_TAKEN: '這個名稱已經有同型別的分類在用了，換一個名稱。',
  CATEGORY_IN_USE: '這個分類已經有交易在用，不能刪除。可以改名，或先改那些交易的分類。',
  CATEGORY_TYPE_MISMATCH: '所選分類的型別和交易型別不符，請重新選擇。',

  // ── 帳戶與交易 ────────────────────────────────────────────────────────────
  ACCOUNT_NAME_TAKEN: '這個名稱已經有帳戶在用了，換一個名稱。',
  ACCOUNT_IN_USE: '這個帳戶已經有交易在用，不能刪除。',
  ACCOUNT_REQUIRED: '這本帳本會連動帳戶餘額，記帳時請選一個帳戶。',
  ACCOUNT_NOT_ALLOWED: '這本帳本不連動帳戶餘額，記帳時不需指定帳戶。',
  TRANSFER_SAME_ACCOUNT: '轉帳的轉出與轉入不能是同一個帳戶，請換其中一個。',

  // ── 借還（3b-1，spec phase-3b1-web.md §4.5）──────────────────────────────
  DEBT_OVERPAYMENT: '金額超過未清餘額。如果對方多給了，請勾選「以此結清」。',
  DEBT_NOT_OPEN: '這筆借還已經結清或免除了。要改本金，請先刪除結清的那筆還款。',
  DEBT_NOT_FORGIVABLE: '只有借出去的錢可以免除。',
  DEBT_TRANSACTION_READ_ONLY: '借還交易要從借還詳情修改。',
  LEDGER_HAS_DEBT_TRANSACTIONS: '這本帳本有借還交易，不能刪除。請改用封存。',
};

/**
 * 把任何拋進來的錯誤換成要給使用者看的文字。三條規則，缺一不可：
 *
 *   1. 是 `ApiError` 且對照表收錄了它的 `errorCode` → 回在地化字串。
 *   2. 是 `ApiError` 但對照表沒收錄 → **回後端原文**。絕不回空字串或佔位文字——
 *      那兩種比英文更糟：使用者連「發生什麼事」都不知道。
 *   3. 不是 `ApiError`（網路層直接失敗）→ 回連線失敗的固定句子。
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // `errorCode` 的型別是 string（後端給什麼就是什麼），不保證落在 ErrorCode
    // 聯集內；查不到就是 undefined，由 ?? 退回後端原文（規則 2）。
    const localized = ERROR_MESSAGES[error.errorCode as ErrorCode];
    return localized ?? error.message;
  }
  return NETWORK_FAILURE_MESSAGE;
}
