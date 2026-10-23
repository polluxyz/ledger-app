import type { StatisticsGroup } from '@ledger/shared';

/** 格式化 API 回傳的萬分比；金額與分母一律不在前端重新計算。 */
export function formatPercentageBps(percentageBps: number): string {
  if (percentageBps === 0) {
    return '<0.01%';
  }
  const whole = Math.floor(percentageBps / 100);
  const fraction = String(percentageBps % 100).padStart(2, '0');
  return fraction === '00' ? `${whole}%` : `${whole}.${fraction}%`;
}

/** 固定分組使用同一份名稱，避免圖表與分類清單之間出現不同標籤。 */
export function fixedGroupLabel(kind: StatisticsGroup['kind']): string {
  switch (kind) {
    case 'DIFFERENCE':
      return '結清差額';
    case 'BAD_DEBT':
      return '呆帳';
    case 'DEBT_FORGIVEN':
      return '債務免除';
    case 'UNCATEGORIZED':
      return '未分類';
    case 'CATEGORY':
      return '分類';
  }
}
