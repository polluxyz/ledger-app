/** 分帳表單暫存欄位；只有 shared 的純函式負責算出可預覽的份額。 */
export interface SplitParticipantDraft {
  key: string;
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

/** 尚未建立的名字用穩定的暫存識別值，讓 shared 預覽仍能辨認參與者。 */
export function splitPreviewCounterpartyId(person: SplitParticipantDraft): string | null {
  if (person.isMe) return null;
  return person.counterpartyId ?? `new:${person.name.trim()}`;
}
