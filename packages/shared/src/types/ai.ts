import type { Cents } from '../money';
import type { ManualTransactionType } from './transaction';

/**
 * AI 文字記帳（4a，spec `docs/specs/phase-4a-ai-text.md` §4）的契約。
 *
 * 使用者打一句話，`POST /ai/parse-transaction` 回 0～10 筆交易草稿。草稿只在畫面上，
 * 使用者確認後前端才呼叫既有的 `POST /ledgers/{ledgerId}/transactions` 寫入（決策 238）。
 * 所以這裡沒有任何寫入用的型別。
 */

/** 一句話的上限（決策 237）。去掉前後空白後計算。 */
export const AI_TEXT_MAX_LENGTH = 200;

/** 一次最多回幾筆草稿（決策 237）。模型回更多只取前面這幾筆。 */
export const AI_MAX_DRAFTS = 10;

export interface ParseTransactionRequest {
  /** 1～200 字，前後空白會先去掉。 */
  text: string;
  /** 目前所在的帳本。必須是我能寫入的帳本，否則 404／403／409（同新增交易）。 */
  ledgerId: string;
  /** 前端的今天，`YYYY-MM-DD`（決策 241）。用瀏覽器所在時區算，同手動新增的預設日期。 */
  today: string;
}

/**
 * 一筆交易草稿。模型對不到、或後端檢查不過的欄位是 `null`（決策 245），由使用者補。
 *
 * `ledgerId` 永遠有值：句子提到的帳本對不到時，用請求的目前帳本（決策 240）。
 */
export interface TransactionDraft {
  ledgerId: string;
  type: ManualTransactionType;
  /** 單位：分。 */
  amount: Cents | null;
  /** `YYYY-MM-DD`。 */
  date: string | null;
  title: string | null;
  /** 支出／收入用；轉帳恆為 null。 */
  categoryId: string | null;
  /**
   * 模型提議的新分類名稱（`phase-4a-ai-new-category.md` 決策 283）。只有支出／收入、
   * 而且 `categoryId` 是 null 時才可能有值，1～50 字。草稿階段不建立分類；使用者確認時
   * 由新增交易 API 的 `newCategoryName` 取得或建立（決策 286）。
   */
  newCategoryName: string | null;
  /** 支出／收入的帳戶，或轉帳的轉出帳戶。 */
  accountId: string | null;
  /** 只有轉帳用；支出／收入恆為 null。 */
  toAccountId: string | null;
}

export interface ParseTransactionResponse {
  /** 0～10 筆。0 筆＝看不懂（決策 246）。 */
  drafts: TransactionDraft[];
}

/**
 * 草稿能不能直接寫入（W210 的 ✓、W211「全部確認」要不要跳過）。
 *
 * - 共同：金額、日期、帳戶都要有。
 * - 支出／收入：要有分類，或有提議的新分類名稱（4a 補充 W241）。
 * - 轉帳：要有轉入帳戶，而且和轉出帳戶不同。分類本來就是 null，不算缺。
 *
 * 名稱是選填（3c 決策 84），不影響。放 shared 是為了前後端只有一份規則（spec §4.1）。
 * 這裡只看「有沒有填」；帳戶、分類合不合法，寫入時由新增交易 API 把關。
 */
export function isDraftComplete(draft: TransactionDraft): boolean {
  if (draft.amount === null || draft.date === null || draft.accountId === null) {
    return false;
  }

  if (draft.type === 'TRANSFER') {
    return draft.toAccountId !== null && draft.toAccountId !== draft.accountId;
  }

  return draft.categoryId !== null || draft.newCategoryName !== null;
}
