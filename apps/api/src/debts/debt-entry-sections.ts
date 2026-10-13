import type { DebtEntrySection } from '@ledger/shared';

type EntryWithBalanceAfter = { balanceAfter: number };

/** 以新到舊的累計餘額找最近一次歸零的位置，供分界和清單過濾共用。 */
export function findDebtEntryHistoryBoundary<T extends EntryWithBalanceAfter>(
  entries: ReadonlyArray<T>,
): number | null {
  const boundary = entries.findIndex((entry) => entry.balanceAfter === 0);
  return boundary === -1 ? null : boundary;
}

/** 只在切頁前呼叫：最近一次歸零的那筆與更早的紀錄屬於歷史。 */
export function filterDebtEntriesBySection<T extends EntryWithBalanceAfter>(
  entries: ReadonlyArray<T>,
  section?: DebtEntrySection,
): T[] {
  if (section === undefined) return [...entries];

  const boundary = findDebtEntryHistoryBoundary(entries);
  if (section === 'history') return boundary === null ? [] : entries.slice(boundary);
  return boundary === null ? [...entries] : entries.slice(0, boundary);
}
