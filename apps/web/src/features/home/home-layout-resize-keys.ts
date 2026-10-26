/** 純鍵盤操作轉換：統一列高與列內分隔線的步距及最小／最大邊界。 */

export function bandResizeDeltaForKey({
  key,
  shiftKey,
  extraHeightPx,
}: {
  key: string;
  shiftKey: boolean;
  extraHeightPx: number;
}): number | null {
  const step = shiftKey ? 64 : 16;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return -step;
  if (key === 'ArrowDown' || key === 'ArrowRight') return step;
  if (key === 'Home') return -extraHeightPx;
  if (key === 'End') return 1600 - extraHeightPx;
  return null;
}

export function splitResizeDeltaForKey({
  key,
  shiftKey,
  currentFirstSize,
  pairSize,
  firstMinimum,
  secondMinimum,
}: {
  key: string;
  shiftKey: boolean;
  currentFirstSize: number;
  pairSize: number;
  firstMinimum: number;
  secondMinimum: number;
}): number | null {
  const step = shiftKey ? 64 : 16;
  if (key === 'Home') return firstMinimum - currentFirstSize;
  if (key === 'End') return pairSize - secondMinimum - currentFirstSize;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -step;
  if (key === 'ArrowRight' || key === 'ArrowDown') return step;
  return null;
}
