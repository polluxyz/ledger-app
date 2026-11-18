import type { Cents } from '@ledger/shared';

/** 舊版結清入口留下的路由狀態鍵名（3f W137、W138）。 */
const SETTLE_INTENT_STATE_KEY = 'settleIntent';

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
