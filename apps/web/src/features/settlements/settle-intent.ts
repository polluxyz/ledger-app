import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Cents } from '@ledger/shared';

/**
 * 從借還頁或往來帳明細點帳本來源，直接記那筆結清（3f W137、W138）。
 *
 * 送出端（借還頁、往來帳明細）與接收端（交易頁）是不同的元件，所以契約集中在這裡，沿用
 * `features/linking/navigation.ts` 的作法：用 `location.state` 帶一次性的指示，交易頁讀到後
 * 切到共享分頁、在來源帳本下方打開預填表單，再把 state 清掉，重新整理不會再開一次。
 *
 * 只帶 API 給的原始值（`CounterpartyLedgerPart` 的 `ledgerId`、`personId`、`amount`），
 * 「我是哪一個 LedgerPerson」由接收端從帳本裡的人找出（`userId`＝目前使用者），前端不算錢。
 */

/** `location.state` 裡的鍵名。 */
export const SETTLE_INTENT_STATE_KEY = 'settleIntent';

export interface SettleIntent {
  ledgerId: string;
  /** 對方在那本帳本的 `LedgerPerson.id`。 */
  personId: string;
  /**
   * 照 API 的正負號：正數＝對方欠我（預填 對方 ─▶ 我），負數＝我欠對方（預填 我 ─▶ 對方）。
   * 預填的金額取絕對值。
   */
  amount: Cents;
}

/** 回傳一個函式：導到交易頁並記這筆結清；來源須是目前可操作的共享帳本。 */
export function useOpenSettleIntent(): (intent: SettleIntent) => void {
  const navigate = useNavigate();
  return useCallback(
    (intent: SettleIntent) => {
      void navigate('/transactions?view=debts&tab=shared', {
        state: { [SETTLE_INTENT_STATE_KEY]: intent },
      });
    },
    [navigate],
  );
}

/** 讀出 `location.state` 裡的結清指示；沒有或形狀不對時是 `null`。 */
export function readSettleIntentState(state: unknown): SettleIntent | null {
  if (typeof state !== 'object' || state === null || !(SETTLE_INTENT_STATE_KEY in state)) {
    return null;
  }
  const value = (state as Record<string, unknown>)[SETTLE_INTENT_STATE_KEY];
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { ledgerId, personId, amount } = value as Record<string, unknown>;
  if (
    typeof ledgerId !== 'string' ||
    typeof personId !== 'string' ||
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount === 0
  ) {
    return null;
  }
  return { ledgerId, personId, amount };
}
