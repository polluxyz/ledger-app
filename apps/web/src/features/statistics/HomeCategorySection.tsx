import { useState, type CSSProperties } from 'react';
import type { StatisticsGroup } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import { fixedGroupLabel, formatPercentageBps } from './charts/chart-format';
import styles from './HomeCategorySection.module.css';

export interface HomeCategorySectionProps {
  expenseGroups: readonly StatisticsGroup[];
  colorOf: (group: StatisticsGroup, isFirstExpenseGroup: boolean) => string;
}

/** 首頁分類卡只呈現 API 的順序、金額與百分比，標題與明細連結由卡片外框提供。 */
export function HomeCategorySection({ expenseGroups, colorOf }: HomeCategorySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = expanded ? expenseGroups : expenseGroups.slice(0, 5);

  return (
    <div className={styles.section}>
      {expenseGroups.length === 0 ? (
        <p className={styles.empty}>本月沒有支出</p>
      ) : (
        <>
          <ul className={styles.list} aria-label="支出分類">
            {visibleGroups.map((group, index) => {
              const name = group.category?.name ?? fixedGroupLabel(group.kind);
              const swatchStyle = {
                '--group-color': colorOf(group, index === 0),
                '--progress-width': `${Math.max(0, Math.min(10_000, group.percentageBps)) / 100}%`,
              } as CSSProperties;
              return (
                <li className={styles.item} key={group.category?.id ?? group.kind}>
                  <div className={styles.summary}>
                    <span className={styles.swatch} style={swatchStyle} aria-hidden="true" />
                    <span className={styles.name}>{name}</span>
                    <span className={styles.amount}>{formatMoney(group.amount)}</span>
                    <span className={styles.percentage}>
                      {formatPercentageBps(group.percentageBps)}
                    </span>
                  </div>
                  <div
                    className={styles.progress}
                    role="progressbar"
                    aria-label={`${name}佔本月支出`}
                    aria-valuemin={0}
                    aria-valuemax={10_000}
                    aria-valuenow={group.percentageBps}
                  >
                    <span className={styles.progressFill} style={swatchStyle} />
                  </div>
                </li>
              );
            })}
          </ul>
          {expenseGroups.length > 5 && (
            <button
              className={styles.toggle}
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? '收起' : `全部 ${expenseGroups.length} 類`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
