import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 從別的頁面（總覽的待確認卡片、邀請頁）打開某個人的往來帳（spec `phase-3b2-web.md` W41、W48）。
 *
 * 3b-2 修訂 1 起目的地是對象頁（`/counterparties`）：連動與合併都是「管人」的事。打開哪個人
 * 是頁面自己的 state，不在網址上，所以用 `location.state` 帶一個一次性的指示；頁面讀到後
 * 打開往來帳、再把 state 清掉，重新整理不會再打開一次。交易頁也讀同一個鍵。
 */

/** `location.state` 裡的鍵名。交易頁與導覽端共用這一個定義。 */
export const OPEN_COUNTERPARTY_STATE_KEY = 'openCounterpartyId';

/** 回傳一個函式：導到借還檢視並打開這個人的往來帳。 */
export function useOpenCounterpartyLedger(): (counterpartyId: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (counterpartyId: string) => {
      void navigate('/counterparties', {
        state: { [OPEN_COUNTERPARTY_STATE_KEY]: counterpartyId },
      });
    },
    [navigate],
  );
}

/** 讀出 `location.state` 裡要打開的對象；沒有或型別不對時是 `null`。 */
export function readOpenCounterpartyState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !(OPEN_COUNTERPARTY_STATE_KEY in state)) {
    return null;
  }
  const value = (state as Record<string, unknown>)[OPEN_COUNTERPARTY_STATE_KEY];
  return typeof value === 'string' ? value : null;
}
