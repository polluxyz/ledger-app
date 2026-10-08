/**
 * 往來紀錄 → 列內符號的對照層（3g 決策 D1）。
 *
 * 「這筆誰給了誰、線上放什麼圖示、完整說明怎麼講」的規則集中在這裡，
 * DebtEntriesList 只負責排版；單元測試鎖住 11 種紀錄的對應。
 */
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { formatMoney } from '../../lib/format';

export type DebtEntryDirection = 'toThem' | 'toMe' | null;
export type DebtEntryMarker = 'none' | 'repay' | 'paidFor' | 'check';

export interface DebtEntryFlow {
  direction: DebtEntryDirection;
  marker: DebtEntryMarker;
  description: string;
}

const ENTRY_MARKERS: Record<DebtEntryKind, DebtEntryMarker> = {
  LEND: 'none',
  BORROW: 'none',
  COLLECT: 'repay',
  REPAY: 'repay',
  PAID_FOR_ME: 'paidFor',
  PAID_FOR_THEM: 'paidFor',
  RECEIVED_FOR_ME: 'paidFor',
  RECEIVED_FOR_THEM: 'paidFor',
  SETTLEMENT: 'check',
  FORGIVE: 'check',
  FORGIVEN: 'check',
};

const DESCRIPTION_TEMPLATES: Record<DebtEntryKind, (displayName: string) => string> = {
  LEND: (name) => `我借${name}`,
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
};

/**
 * 前端不算錢：方向只讀 delta 正負號（正＝我 → 對方），不依種類推導；
 * 結清差額與免除不畫箭頭，只有打勾圖示。
 */
export function getDebtEntryFlow(entry: DebtEntry, displayName: string): DebtEntryFlow {
  const marker = ENTRY_MARKERS[entry.kind];
  const direction =
    marker === 'check' ? null : entry.delta > 0 ? 'toThem' : entry.delta < 0 ? 'toMe' : null;

  return {
    direction,
    marker,
    description: `${DESCRIPTION_TEMPLATES[entry.kind](displayName)} ${formatMoney(Math.abs(entry.delta))}`,
  };
}
