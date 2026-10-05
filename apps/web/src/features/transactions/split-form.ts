import { fillRemainingShares, type FillRemainingResult, type SplitPrecision } from '@ledger/shared';

/** 分帳表單暫存欄位；key 是人跨表單共用的識別字串。 */
export interface SplitParticipantDraft {
  key: string;
  /** 3c 送出的對象 id；3e 以 key 保存 LedgerPerson.id，不使用這個欄位。 */
  counterpartyId: string | null;
  name: string;
  /** 新輸入的名字雖暫時沒有 id，也不能被當成「我」。 */
  isMe: boolean;
  included: boolean;
  amountFixed: boolean;
  amountInput: string;
  amountValue: number;
  ratioFixed: boolean;
  ratioInput: string;
  ratioValue: number;
}

/** 3c 將「我」映成不會與 UUID 衝突的 key，與 3e 的 LedgerPerson.id 共用 keyed API。 */
export const SPLIT_ME_KEY = '\u0000me';

/**
 * 自訂分法沿用 shared 的自動調整規則，只把人的識別從對象 id 轉成通用 key。
 * 3c 傳入 fallbackKey 保留「付款人不在名單時由我吸收」；3e 不傳 fallback，照 keyed API 預設選第一人。
 */
export function fillRemainingSharesByKey(input: {
  total: number;
  method: 'AMOUNT' | 'RATIO';
  precision: SplitPrecision;
  payerKey: string | null;
  fallbackKey?: string;
  participants: Array<{ key: string; value?: number }>;
}): FillRemainingResult {
  const usesMeFallback = input.fallbackKey !== undefined;
  const missingPayerKey = '\u0000missing-payer';
  return fillRemainingShares({
    total: input.total,
    method: input.method,
    precision: input.precision,
    payerCounterpartyId:
      input.payerKey === input.fallbackKey && usesMeFallback
        ? null
        : (input.payerKey ?? (usesMeFallback ? null : missingPayerKey)),
    participants: input.participants.map((participant) => ({
      counterpartyId:
        usesMeFallback && participant.key === input.fallbackKey ? null : participant.key,
      value: participant.value,
    })),
  });
}

/** 尚未建立的 3c 名字用暫存 key，讓它與付款人預覽仍能辨認為同一人。 */
export function splitPreviewCounterpartyId(person: SplitParticipantDraft): string | null {
  if (person.isMe) return null;
  return person.counterpartyId ?? `new:${person.name.trim()}`;
}
