import type { LedgerRole } from '@ledger/shared';

/** 一位待加入的成員。`error` 由呼叫端在送出失敗後填入。 */
export interface MemberDraft {
  /** 這一列的本機識別，只用於 React 的 key 與更新定位，不會送給後端。 */
  key: string;
  email: string;
  role: LedgerRole;
  /** 上次送出時後端回的訊息；成功或尚未送出時為 undefined。 */
  error?: string;
}

// 每一列需要一個穩定的 key。用遞增數字而非 email——email 會被編輯，拿它當 key
// 會讓 React 在每次按鍵時重建輸入框，游標跟著跳掉。
let nextKey = 0;

/** 產生一列空白的參與者。 */
export function newParticipant(): MemberDraft {
  nextKey += 1;
  return { key: `participant-${nextKey}`, email: '', role: 'EDITOR' };
}
