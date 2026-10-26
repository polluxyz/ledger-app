import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AI_TEXT_MAX_LENGTH } from '@ledger/shared';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { isLedgerWritable } from '../ledgers/use-ledgers';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { useAiSession } from './ai-session';
import styles from './AiEntry.module.css';

interface AiEntryProps {
  ledger: LedgerSummary | undefined;
  isLedgerLoading?: boolean;
  ledgerError?: unknown;
  isVisible?: boolean;
}

/** 交易與首頁共用的橫條入口；展開狀態留在頁面，解析文字與錯誤留在 AI session。 */
export function AiEntry({
  ledger,
  isLedgerLoading = false,
  ledgerError,
  isVisible = true,
}: AiEntryProps) {
  const { element } = usePageToolbarSlot();
  const { error, isParsing, parse, setText, text } = useAiSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const tooltipId = `${inputId}-tooltip`;
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const isWritable = isLedgerWritable(ledger);

  useEffect(() => {
    if (isExpanded) inputRef.current?.focus();
  }, [element, isExpanded]);

  function collapse() {
    setIsExpanded(false);
    toggleRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ledger || !isWritable || isParsing || text.trim() === '') return;
    if (await parse(text, ledger.id)) collapse();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      collapse();
    }
  }

  if (
    !element ||
    !isVisible ||
    isLedgerLoading ||
    (ledgerError !== undefined && ledgerError !== null) ||
    ledger === undefined
  ) {
    return null;
  }

  return createPortal(
    <div className={styles.dock} data-open={isExpanded}>
      <form
        id={inputId}
        className={styles.composer}
        aria-hidden={!isExpanded}
        aria-busy={isParsing}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <label className={styles.visuallyHidden} htmlFor={`${inputId}-text`}>
          用一句話記帳
        </label>
        <input
          ref={inputRef}
          id={`${inputId}-text`}
          className={styles.input}
          type="text"
          value={text}
          maxLength={AI_TEXT_MAX_LENGTH}
          placeholder="例如：早餐 60 現金、午餐 120 刷卡"
          disabled={isParsing}
          tabIndex={isExpanded ? 0 : -1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <Button
          type="submit"
          aria-label={isParsing ? '處理中…' : undefined}
          aria-busy={isParsing}
          disabled={!isExpanded || !isWritable || isParsing || text.trim() === ''}
          tabIndex={isExpanded ? 0 : -1}
        >
          {isParsing ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              <span className={styles.visuallyHidden}>處理中…</span>
            </>
          ) : (
            '送出'
          )}
        </Button>
      </form>
      <button
        ref={toggleRef}
        className={styles.toggle}
        type="button"
        aria-label={isWritable ? 'AI 記帳' : 'AI 記帳：只能檢視'}
        aria-expanded={isExpanded}
        aria-controls={inputId}
        aria-describedby={!isWritable ? tooltipId : undefined}
        aria-disabled={!isWritable || undefined}
        data-error={error !== null}
        onClick={() => {
          if (!isWritable) return;
          if (isExpanded) collapse();
          else setIsExpanded(true);
        }}
      >
        <Icon name="sparkle" size={24} />
        {!isWritable && (
          <span id={tooltipId} className={styles.tooltip} role="tooltip">
            只能檢視
          </span>
        )}
      </button>
      {error !== null && (
        <p
          className={isExpanded ? styles.error : styles.visuallyHidden}
          id={errorId}
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      )}
    </div>,
    element,
  );
}
