/**
 * 把卡片目前的矩形與指標座標轉成四方向落點。呼叫端每次移動與放開都重新量矩形，
 * 避免拖動期間其他內容長高後，仍沿用起始位置的舊座標。
 */

export type HomeLayoutDropSide = 'left' | 'right' | 'top' | 'bottom';

export interface DropRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function sideAtPoint(
  rectangle: DropRectangle,
  clientX: number,
  clientY: number,
): HomeLayoutDropSide | null {
  const right = rectangle.left + rectangle.width;
  const bottom = rectangle.top + rectangle.height;
  if (
    rectangle.width <= 0 ||
    rectangle.height <= 0 ||
    clientX < rectangle.left ||
    clientX > right ||
    clientY < rectangle.top ||
    clientY > bottom
  ) {
    return null;
  }

  const horizontalDistance = Math.abs((clientX - rectangle.left) / rectangle.width - 0.5);
  const verticalDistance = Math.abs((clientY - rectangle.top) / rectangle.height - 0.5);
  // 同距離時沿用 spike 驗證過的規則，選垂直方向；中線上的點落到右側或下側。
  if (horizontalDistance > verticalDistance)
    return clientX < rectangle.left + rectangle.width / 2 ? 'left' : 'right';
  return clientY < rectangle.top + rectangle.height / 2 ? 'top' : 'bottom';
}
