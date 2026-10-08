import { Undo2 } from 'lucide-react';
import styles from './MiniOweArrow.module.css';

interface MiniOweArrowProps {
  /** 欠錢的人（箭頭起點）。 */
  from: string;
  /** 頭貼標籤；多個名字同首字時由清單計算後傳入。 */
  fromLabel?: string;
  /** 被欠的人（箭頭終點）。 */
  to: string;
  /** 頭貼標籤；多個名字同首字時由清單計算後傳入。 */
  toLabel?: string;
  /** 還款在線中點放「回頭」圖示，表示被還掉的那筆欠款。 */
  repay?: boolean;
  /** 確認預覽空間較窄時縮小頭貼與箭線，仍沿用同一個方向符號。 */
  compact?: boolean;
}

/**
 * 列內小頭貼箭頭：灰色實線（與 DebtArrow 同一種線色），從欠錢的人指向被欠的人。
 * 頭貼只有一個字，兩個人的名字同首字時分不出來，所以完整語意一律由外層的說明句
 * 提供，本身對輔助技術隱藏。
 */
export function MiniOweArrow({
  from,
  fromLabel,
  to,
  toLabel,
  repay = false,
  compact = false,
}: MiniOweArrowProps) {
  return (
    <span className={`${styles.mini} ${compact ? styles.compact : ''}`} aria-hidden="true">
      <span className={styles.avatar} title={from}>
        {fromLabel ?? Array.from(from)[0] ?? ''}
      </span>
      <span className={styles.line}>
        {repay && (
          <span className={styles.marker}>
            <Undo2 size={13} strokeWidth={2} />
          </span>
        )}
      </span>
      <span className={styles.avatar} title={to}>
        {toLabel ?? Array.from(to)[0] ?? ''}
      </span>
    </span>
  );
}
