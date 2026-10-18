/**
 * 往來紀錄 → 列內符號的對照層（3g 決策 D1，2026-10-08 修訂成「誰欠誰」箭頭）。
 *
 * 「這筆之後誰欠誰、線上放什麼圖示、完整說明怎麼講」的規則集中在這裡，
 * DebtEntriesList 只負責排版；單元測試鎖住 11 種紀錄的對應。
 */
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { formatMoney } from '../../lib/format';

/** 箭頭方向＝誰欠誰：起點是欠錢的人。`null`（結清差額、免除、被免除）不畫箭頭。 */
export type DebtEntryDirection = 'theyOweMe' | 'iOweThem' | null;

/** 線中點的圖示：還款放「回頭」；其餘有箭頭的不放圖示，調整紀錄用打勾。 */
export type DebtEntryMarker = 'none' | 'repay' | 'check';

export interface DebtEntryFlow {
  direction: DebtEntryDirection;
  marker: DebtEntryMarker;
  description: string;
}

const CHECK_KINDS: ReadonlySet<DebtEntryKind> = new Set(['SETTLEMENT', 'FORGIVE', 'FORGIVEN']);
const REPAY_KINDS: ReadonlySet<DebtEntryKind> = new Set(['COLLECT', 'REPAY']);

const DESCRIPTION_TEMPLATES: Record<DebtEntryKind, (displayName: string) => string> = {
  LEND: (name) => `我借給${name}`,
  BORROW: (name) => `我向${name}借`,
  COLLECT: (name) => `${name}還我`,
  REPAY: (name) => `我還${name}`,
  PAID_FOR_ME: (name) => `${name}幫我付`,
  PAID_FOR_THEM: (name) => `我幫${name}付`,
  RECEIVED_FOR_ME: (name) => `${name}幫我代收`,
  RECEIVED_FOR_THEM: (name) => `我幫${name}代收`,
  SETTLEMENT: (name) => `我和${name}結清差額`,
  FORGIVE: (name) => `我免除${name}欠我的`,
  FORGIVEN: (name) => `${name}免除我欠的款項`,
  LEDGER_CARRY_OVER: () => '帳本轉入',
};

/**
 * 前端不算錢：一般紀錄只讀 `delta` 正負號（正＝對方多欠我 → 對方欠我），
 * 不依種類推導；結清差額與免除不畫箭頭，只有打勾圖示。
 *
 * 還款（`COLLECT`、`REPAY`）例外，改依種類決定方向：還款讓欠款**變少**，所以它的
 * `delta` 正負號恰好與一般紀錄相反（`COLLECT`＝對方還我，delta 是負的，但被還掉的
 * 是「對方欠我」那筆）。箭頭要表達被還掉的那筆欠款，不能套正負號規則，否則方向會反。
 */
export function getDebtEntryFlow(entry: DebtEntry, displayName: string): DebtEntryFlow {
  const marker = CHECK_KINDS.has(entry.kind)
    ? 'check'
    : REPAY_KINDS.has(entry.kind)
      ? 'repay'
      : 'none';

  let direction: DebtEntryDirection = null;
  if (marker !== 'check') {
    if (entry.kind === 'COLLECT') {
      direction = 'theyOweMe';
    } else if (entry.kind === 'REPAY') {
      direction = 'iOweThem';
    } else {
      direction = entry.delta > 0 ? 'theyOweMe' : entry.delta < 0 ? 'iOweThem' : null;
    }
  }

  return {
    direction,
    marker,
    description: `${DESCRIPTION_TEMPLATES[entry.kind](displayName)} ${formatMoney(Math.abs(entry.delta))}`,
  };
}
