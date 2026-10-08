import { Receipt, Undo2 } from 'lucide-react';
import type { DebtEntryMarker } from './entry-flow';
import styles from './MiniFlowArrow.module.css';

type ArrowMarker = Exclude<DebtEntryMarker, 'check'>;

/** 金色虛線（flow）在線中點放的圖示：還款＝回頭箭頭、代付／代收＝收據；借錢沒有圖示。 */
const FLOW_MARKER_ICONS = { none: null, repay: Undo2, paidFor: Receipt } as const;

interface MiniFlowArrowProps {
  from: string;
  to: string;
  variant: 'flow' | 'owe';
  marker?: ArrowMarker;
}

/**
 * 列內小頭貼箭頭：`flow` 金色虛線表示這一筆的價值流向，`owe` 灰色實線表示
 * 目前的欠款方向。完整語意由外層的說明句提供，本身對輔助技術隱藏。
 */
export function MiniFlowArrow({ from, to, variant, marker = 'none' }: MiniFlowArrowProps) {
  const MarkerIcon = variant === 'flow' ? FLOW_MARKER_ICONS[marker] : null;

  return (
    <span className={styles.mini + ' ' + styles[variant]} aria-hidden="true">
      <span className={styles.avatar}>{Array.from(from)[0] ?? ''}</span>
      <span className={styles.line}>
        {MarkerIcon && (
          <span className={styles.marker}>
            <MarkerIcon size={13} strokeWidth={2} />
          </span>
        )}
      </span>
      <span className={styles.avatar}>{Array.from(to)[0] ?? ''}</span>
    </span>
  );
}
