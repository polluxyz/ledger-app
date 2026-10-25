import type { CSSProperties, ReactNode } from 'react';
import type { HomeCardId } from '@ledger/shared';
import { Link } from 'react-router-dom';
import styles from './HomeCard.module.css';

/** 首頁共用卡片外框，統一標題、操作區和內容間距，並保留編輯模式的控制插槽。 */
export interface HomeCardProps {
  cardId: HomeCardId;
  title: ReactNode;
  children: ReactNode;
  titleMeta?: ReactNode;
  action?: ReactNode;
  headerContent?: ReactNode;
  ariaLabel?: string;
  href?: string;
  extraHeightPx?: number;
}

export function HomeCard({
  cardId,
  title,
  children,
  titleMeta,
  action,
  headerContent,
  ariaLabel,
  href,
  extraHeightPx = 0,
}: HomeCardProps) {
  const headingId = `home-card-${cardId}-heading`;
  const style = {
    '--home-card-extra-height': `${extraHeightPx}px`,
  } as CSSProperties;
  const content = (
    <>
      <header className={styles.header}>
        <span className={styles.controlsSlot} data-home-card-controls="" aria-hidden="true" />
        {headerContent ? (
          <>
            <h2 className={styles.srOnly} id={headingId}>
              {title}
            </h2>
            <div className={styles.customHeader}>{headerContent}</div>
          </>
        ) : (
          <>
            <div className={styles.titleGroup}>
              <h2 className={styles.heading} id={headingId}>
                {title}
              </h2>
              {titleMeta}
            </div>
            {action && <div className={styles.action}>{action}</div>}
          </>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </>
  );

  const className = `${styles.card} ${href ? styles.linkCard : ''}`.trim();
  if (href) {
    return (
      <Link className={className} style={style} to={href} data-home-card-id={cardId}>
        {content}
      </Link>
    );
  }
  return (
    <section
      className={className}
      style={style}
      data-home-card-id={cardId}
      aria-labelledby={ariaLabel ? undefined : headingId}
      aria-label={ariaLabel}
    >
      {content}
    </section>
  );
}
