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

  // ── 借還（3b-1 往來帳版，spec phase-3b1-web.md §4.6）──────────────────────
  COUNTERPARTY_NAME_TAKEN: '已經有同名的對象了，換一個名字。',
  COUNTERPARTY_HAS_ENTRIES: '這個對象還有往來紀錄，不能刪除。',
  NOTHING_TO_FORGIVE: '對方目前沒有欠你錢，沒有東西可以免除。',
  DEBT_ENTRY_NOT_EDITABLE: '結清差額與免除不能修改，要調整請刪除後重記。',
  DEBT_TRANSACTION_READ_ONLY: '這筆交易來自借還，請到借還的往來帳修改。',
  LEDGER_HAS_DEBT_TRANSACTIONS: '這本帳本有借還交易，不能刪除。請改用封存。',
  NOTHING_TO_REPAY: '目前和對方沒有欠款，不需要還款。',
  REPAYMENT_EXCEEDS_BALANCE: '還款超過目前的欠款。要兩清請勾「以此結清」，或把多出的部分另記一筆。',

  // ── 連動（3b-2，spec phase-3b2-web.md §4.7）──────────────────────────────
  // 後端沿用 3a 的好友錯誤碼，但畫面不出現「好友」（W22），所以這幾個一律改寫。
  CANNOT_FRIEND_SELF: '不能邀請自己。',
  ALREADY_FRIENDS: '你們已經建立過關係了。重新整理後再試一次。',
  FRIEND_REQUEST_PENDING: '已經送出邀請了，等對方接受。',
  FRIEND_REQUEST_NOT_PENDING: '這個邀請已經處理過了。',
  INVITE_LINK_INVALID: '這個連結無效或已過期，請對方重新產生。',
  ALREADY_LINKED: '你們已經連動了，或這個人已經連到別的帳號。',
  COUNTERPARTY_LINKED: '這個人已經連動中。要刪除或改接別人，請先解除連動。',
  LINK_INVITE_FROM_THEM: '對方已經邀請你連動了，到總覽接受就好。',
  PROPOSAL_NOT_PENDING: '這筆已經處理過了，畫面會重新整理。',
  MERGE_NOT_ALLOWED: '只能把沒連動的人併進已連動的人。',
};

/**
 * 邀請連動視窗專用的覆寫（spec §4.7）。同一個代碼在帳本成員那邊有自己的說法
 * （「再加入」），在這裡要改成連動的語境。用法：`toUserMessage(error, LINK_INVITE_MESSAGES)`。
 */
export const LINK_INVITE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  USER_NOT_FOUND: '找不到使用這個 email 的帳號。請對方先註冊。',
};

/**
 * 把任何拋進來的錯誤換成要給使用者看的文字。三條規則，缺一不可：
 *
 *   1. 是 `ApiError` 且對照表收錄了它的 `errorCode` → 回在地化字串。
 *   2. 是 `ApiError` 但對照表沒收錄 → **回後端原文**。絕不回空字串或佔位文字——
 *      那兩種比英文更糟：使用者連「發生什麼事」都不知道。
 *   3. 不是 `ApiError`（網路層直接失敗）→ 回連線失敗的固定句子。
 */
export function toUserMessage(
  error: unknown,
  overrides: Partial<Record<ErrorCode, string>> = {},
): string {
  if (error instanceof ApiError) {
    // `errorCode` 的型別是 string（後端給什麼就是什麼），不保證落在 ErrorCode
    // 聯集內；查不到就是 undefined，由 ?? 退回後端原文（規則 2）。
    // `overrides` 讓特定畫面換一種說法（例如邀請連動視窗的 USER_NOT_FOUND）。
    const code = error.errorCode as ErrorCode;
    const localized = overrides[code] ?? ERROR_MESSAGES[code];
    return localized ?? error.message;
  }
  return NETWORK_FAILURE_MESSAGE;
}
