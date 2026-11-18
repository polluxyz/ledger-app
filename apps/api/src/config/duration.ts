/** 登入效期只接受明確單位，並確保換算結果能安全地用來建立到期日期。 */
export function parseDurationToMs(value: string): number {
  if (!/^[1-9]\d*[smhd]$/.test(value)) {
    throw new Error('Invalid duration');
  }
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = Number(value.slice(0, -1)) * units[value.slice(-1)]!;
  if (
    !Number.isSafeInteger(duration) ||
    !Number.isFinite(new Date(Date.now() + duration).getTime())
  ) {
    throw new Error('Invalid duration');
  }
  return duration;
}
