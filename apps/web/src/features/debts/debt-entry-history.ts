/**
 * 以 API 的累計餘額切開未還清與歷史紀錄。
 *
 * API 已按新到舊排序；最新一筆歸零的紀錄是歷史邊界，前面的資料仍未還清。
 */
export function splitDebtEntriesByBalanceZero<T extends { balanceAfter?: number }>(
  entries: readonly T[],
): { outstanding: readonly T[]; history: readonly T[] } {
  const boundary = entries.findIndex((entry) => entry.balanceAfter === 0);
  if (boundary === -1) {
    return { outstanding: entries, history: [] };
  }

  return {
    outstanding: entries.slice(0, boundary),
    history: entries.slice(boundary),
  };
}
