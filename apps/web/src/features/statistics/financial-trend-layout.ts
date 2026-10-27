/** 柱圖只換算座標與刻度；先正規化，避免正負極大安全整數相減時溢出。 */
export function getFinancialTrendLayout(totals: readonly number[], width: number, height: number) {
  const scale = Math.max(...totals.map(Math.abs), 0) || 10_000;
  const minimum = Math.min(0, ...totals.map((total) => total / scale));
  const maximum = Math.max(0, ...totals.map((total) => total / scale));
  const rawStep = (maximum - minimum || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rawStep)!;
  const lower = Math.floor(minimum / step) * step;
  const upper = Math.ceil(maximum / step) * step || (lower === 0 ? step * 2 : 0);
  const top = 12;
  const bottom = Math.max(top + 1, height - 34);
  const left = 52;
  const right = Math.max(left + 1, width - 14);
  const y = (normalized: number) =>
    bottom - ((normalized - lower) / (upper - lower)) * (bottom - top);
  const baseline = y(0);
  const slotWidth = (right - left) / Math.max(1, totals.length);
  const barWidth = Math.min(30, slotWidth * 0.56);
  const ticks = Array.from({ length: Math.round((upper - lower) / step) + 1 }, (_, index) => {
    const normalized = lower + index * step;
    return { amount: normalized * scale, y: y(normalized), zero: Math.abs(normalized) < step / 2 };
  });
  const bars = totals.map((total, index) => {
    const end = y(total / scale);
    return {
      x: left + slotWidth * (index + 0.5),
      end,
      y: Math.min(end, baseline),
      height: Math.abs(end - baseline),
    };
  });
  return { width, height, left, right, baseline, barWidth, slotWidth, ticks, bars };
}

export type FinancialTrendLayout = ReturnType<typeof getFinancialTrendLayout>;
