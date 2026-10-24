/** 趨勢圖最後一點的標籤座標規則獨立在這裡，讓方向與邊界可用純函式驗證。 */

interface ChartPointPosition {
  x: number;
  y: number;
}

interface ChartVerticalBounds {
  top: number;
  bottom: number;
}

interface FinalLabelYPositions {
  valueY: number;
  monthY: number;
}

const POINT_RENDERED_RADIUS = 7;
const LABEL_POINT_GAP = 2;
const LABEL_STACK_GAP = 2;
const VALUE_LABEL_ASCENT = 14;
const VALUE_LABEL_DESCENT = 4;
const MONTH_LABEL_ASCENT = 11;
const MONTH_LABEL_DESCENT = 3;

export function getFinalLabelYPositions(
  previousPoint: ChartPointPosition | undefined,
  finalPoint: ChartPointPosition,
  bounds: ChartVerticalBounds,
): FinalLabelYPositions {
  const labelBaselineGap = VALUE_LABEL_DESCENT + LABEL_STACK_GAP + MONTH_LABEL_ASCENT;
  const above = {
    valueY:
      finalPoint.y -
      POINT_RENDERED_RADIUS -
      LABEL_POINT_GAP -
      MONTH_LABEL_DESCENT -
      labelBaselineGap,
    monthY: finalPoint.y - POINT_RENDERED_RADIUS - LABEL_POINT_GAP - MONTH_LABEL_DESCENT,
  };
  const below = {
    valueY: finalPoint.y + POINT_RENDERED_RADIUS + LABEL_POINT_GAP + VALUE_LABEL_ASCENT,
    monthY:
      finalPoint.y +
      POINT_RENDERED_RADIUS +
      LABEL_POINT_GAP +
      VALUE_LABEL_ASCENT +
      labelBaselineGap,
  };
  const fits = (positions: FinalLabelYPositions) =>
    positions.valueY - VALUE_LABEL_ASCENT >= bounds.top &&
    positions.monthY + MONTH_LABEL_DESCENT <= bounds.bottom;
  const shouldPlaceBelow = previousPoint !== undefined && previousPoint.y < finalPoint.y;
  const preferred = shouldPlaceBelow ? below : above;
  const alternate = shouldPlaceBelow ? above : below;

  if (fits(preferred)) return preferred;
  if (fits(alternate)) return alternate;

  const minimumValueY = bounds.top + VALUE_LABEL_ASCENT;
  const maximumValueY = bounds.bottom - labelBaselineGap - MONTH_LABEL_DESCENT;
  const valueY =
    maximumValueY < minimumValueY
      ? minimumValueY
      : Math.min(Math.max(preferred.valueY, minimumValueY), maximumValueY);

  return { valueY, monthY: valueY + labelBaselineGap };
}
