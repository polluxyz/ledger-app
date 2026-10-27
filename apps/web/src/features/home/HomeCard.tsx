import type { CSSProperties, ReactNode } from 'react';
import type { HomeCardId } from '@ledger/shared';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
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
  editing?: boolean;
  controls?: ReactNode;
  isDragging?: boolean;
  dropIndicator?: ReactNode;
  cardRef?: (element: HTMLElement | null) => void;
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
  editing = false,
  controls,
  isDragging = false,
  dropIndicator,
  cardRef,
}: HomeCardProps) {
  const headingId = `home-card-${cardId}-heading`;
  const summaryIcon =
    cardId === 'expense'
      ? 'arrowUpRight'
      : cardId === 'income'
        ? 'arrowDownLeft'
        : cardId === 'net'
          ? 'equal'
          : null;
  const decoration =
    cardId === 'net' ? <span className={styles.summaryDecoration} aria-hidden="true" /> : null;
  const style = {
    '--home-card-extra-height': `${extraHeightPx}px`,
  } as CSSProperties;
  const headerMain = headerContent ? (
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
      {summaryIcon && (
        <span className={styles.summaryIcon} data-home-summary-icon={cardId} aria-hidden="true">
          <Icon name={summaryIcon} size={18} />
        </span>
      )}
    </>
  );
  const className =
    `${styles.card} ${href ? styles.linkCard : ''} ${editing ? styles.editingCard : ''} ${isDragging ? styles.dragging : ''}`.trim();

  if (editing) {
    return (
      <section
        ref={cardRef}
        className={className}
        style={style}
        data-home-card-id={cardId}
        aria-labelledby={ariaLabel ? undefined : headingId}
        aria-label={ariaLabel}
      >
        {decoration}
        <header className={styles.header}>
          <div
            className={`${styles.controlsSlot} ${styles.editingControlsSlot}`}
            data-home-card-controls=""
          >
            {controls}
          </div>
          <div className={styles.headerMain} inert>
            {headerMain}
          </div>
        </header>
        <div className={styles.body} data-home-card-body="" inert>
          {children}
        </div>
        {dropIndicator}
      </section>
    );
  }

  const content = (
    <>
      {decoration}
      <header className={styles.header}>
        <span className={styles.controlsSlot} data-home-card-controls="" aria-hidden="true" />
        {headerMain}
      </header>
      <div className={styles.body} data-home-card-body="">
        {children}
      </div>
    </>
  );

  if (href) {
    return (
      <Link ref={cardRef} className={className} style={style} to={href} data-home-card-id={cardId}>
        {content}
      </Link>
    );
  }
  return (
    <section
      ref={cardRef}
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
