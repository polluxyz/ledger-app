import { AI_MAX_DRAFTS, type ManualTransactionType } from '@ledger/shared';

/**
 * 模型回應的格式：後端要求模型照這個結構回 JSON（4a plan §1.2「模型回應的格式」）。
 *
 * 只存在模型與後端之間，前端看不到。和 API 回應（`TransactionDraft`）的差別：
 *
 * - 帳本、分類、帳戶用短代號（`L1`、`C1`、`A1`），不是 UUID。代號對照表只在伺服器記憶體，
 *   模型看不到也猜不到真的 id（決策 253）。
 * - 金額是「元」的字串（`"60"`、`"12.5"`），不是分的整數。模型算錯 ×100 的機率比較高，
 *   換算交給後端用 `parseMoneyInput` 做，不經過浮點數。
 * - 每個 key 都必填，`null` 表示句子沒提。帳戶另有 `"?"`：提了但對不到。兩者處理不同
 *   （沒提用預設帳戶，對不到留空讓使用者補，決策 242）。
 *
 * 這裡的型別是「模型應該回什麼」，不是「模型實際回了什麼」。實際的回應一律當 `unknown`，
 * 由 `ai-draft-validation.ts` 逐欄檢查，不可直接斷言成這個型別。
 */

/** 帳戶「提了但對不到」的標記。 */
export const AI_WIRE_UNMATCHED = '?';

export interface AiWireDraft {
  type: ManualTransactionType;
  /** 帳本代號；`null`＝沒提。 */
  ledger: string | null;
  /** 元的字串，只有數字與最多 2 位小數；`null`＝沒提。 */
  amountYuan: string | null;
  /** `YYYY-MM-DD`；`null`＝沒提（用今天）。 */
  date: string | null;
  title: string | null;
  /** 分類代號；`null`＝沒提或對不到。轉帳不用。 */
  category: string | null;
  /** 帳戶代號；`null`＝沒提；`"?"`＝提了但對不到。 */
  account: string | null;
  /** 轉入帳戶代號，只有轉帳用；`null`＝沒提；`"?"`＝提了但對不到。 */
  toAccount: string | null;
}

export interface AiWireResponse {
  drafts: AiWireDraft[];
}

const nullableString = { type: ['string', 'null'] } as const;

/**
 * 給模型看的 JSON schema（放進 system 指示，GLM provider 送出時附上）。
 *
 * `additionalProperties: false` 與 `required` 只是對模型的要求，模型不一定照做。
 * 真正的把關在 `ai-draft-validation.ts`。
 */
export const AI_WIRE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['drafts'],
  properties: {
    drafts: {
      type: 'array',
      maxItems: AI_MAX_DRAFTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'ledger',
          'amountYuan',
          'date',
          'title',
          'category',
          'account',
          'toAccount',
        ],
        properties: {
          type: { type: 'string', enum: ['EXPENSE', 'INCOME', 'TRANSFER'] },
          ledger: nullableString,
          amountYuan: { type: ['string', 'null'], pattern: '^\\d+(\\.\\d{1,2})?$' },
          date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          title: nullableString,
          category: nullableString,
          account: nullableString,
          toAccount: nullableString,
        },
      },
    },
  },
};
