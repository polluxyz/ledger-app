/** 格式化 API 回傳的萬分比；金額與分母一律不在前端重新計算。 */
export function formatPercentageBps(percentageBps: number): string {
  if (percentageBps === 0) {
    return '<0.01%';
  }
  const whole = Math.floor(percentageBps / 100);
  const fraction = String(percentageBps % 100).padStart(2, '0');
  return fraction === '00' ? `${whole}%` : `${whole}.${fraction}%`;
}
