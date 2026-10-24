import { useState, type CSSProperties } from 'react';
import type { StatisticsGroup } from '@ledger/shared';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../lib/format';
import { fixedGroupLabel, formatPercentageBps } from './charts/chart-format';
import styles from './HomeCategorySection.module.css';

export interface HomeCategorySectionProps {
  expenseGroups: readonly StatisticsGroup[];
  ledgerName: string | null;
  statisticsHref: string;
  colorOf: (group: StatisticsGroup) => string;
}

/** 首頁支出分類只呈現 API 的順序、金額與百分比，顏色由呼叫端提供。 */
export function HomeCategorySection({
  expenseGroups,
  ledgerName,
  statisticsHref,
  colorOf,
}: HomeCategorySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = expanded ? expenseGroups : expenseGroups.slice(0, 5);
  const heading = ledgerName ? `${ledgerName} · 本月支出` : '本月支出';

  return (
    <section className={styles.section} aria-labelledby="home-category-heading">
      <header className={styles.header}>
        <h3 className={styles.heading} id="home-category-heading">
          {heading}
        </h3>
        <Link className={styles.details} to={statisticsHref}>
          明細 →
        </Link>
      </header>

      {expenseGroups.length === 0 ? (
        <p className={styles.empty}>本月沒有支出</p>
      ) : (
        <>
          <ul className={styles.list} aria-label="支出分類">
            {visibleGroups.map((group) => {
              const name = group.category?.name ?? fixedGroupLabel(group.kind);
              const swatchStyle = { '--group-color': colorOf(group) } as CSSProperties;
              return (
                <li className={styles.item} key={group.category?.id ?? group.kind}>
                  <span className={styles.swatch} style={swatchStyle} aria-hidden="true" />
                  <span className={styles.name}>{name}</span>
                  <span className={styles.amount}>{formatMoney(group.amount)}</span>
                  <span className={styles.percentage}>
                    {formatPercentageBps(group.percentageBps)}
                  </span>
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
    </section>
  );
}
