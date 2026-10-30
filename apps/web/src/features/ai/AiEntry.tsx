import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AI_TEXT_MAX_LENGTH } from '@ledger/shared';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { isLedgerWritable } from '../ledgers/use-ledgers';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { useAiSession } from './ai-session';
import { useVoiceInput } from './use-voice-input';
import styles from './AiEntry.module.css';

interface AiEntryProps {
  ledger: LedgerSummary | undefined;
  isLedgerLoading?: boolean;
  ledgerError?: unknown;
  isVisible?: boolean;
}

/** 交易與首頁共用的橫條入口；辨識只把 final 文字交回跨頁 AI session。 */
export function AiEntry({
  ledger,
  isLedgerLoading = false,
  ledgerError,
  isVisible = true,
}: AiEntryProps) {
  const { element } = usePageToolbarSlot();
  const {
    error,
    isParsing,
    parse,
    setText,
    clearInput: clearSessionInput,
    text,
    getTextVersion,
    getIdentitySnapshot,
    isIdentityCurrent,
  } = useAiSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const [lengthError, setLengthError] = useState<string | null>(null);
  const [voiceFocusRequest, setVoiceFocusRequest] = useState(0);
  const isExpandedRef = useRef(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const tooltipId = `${inputId}-tooltip`;
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const microphoneRef = useRef<HTMLButtonElement>(null);
  const focusTimeoutRef = useRef<number | null>(null);
  const handledVoiceFocusRequestRef = useRef(0);
  const returnFocusToMicrophoneRef = useRef(false);
  const isWritable = isLedgerWritable(ledger);
  const entryVisible = Boolean(
    element &&
    isVisible &&
    !isLedgerLoading &&
    (ledgerError === undefined || ledgerError === null) &&
    ledger !== undefined,
  );
  const canStartVoice = Boolean(entryVisible && isWritable && !isParsing && text.trim() === '');
  const requestVoiceInputFocus = useCallback(() => {
    setVoiceFocusRequest((current) => current + 1);
  }, []);
  const voice = useVoiceInput({
    ledgerId: ledger?.id,
    isVisible: entryVisible,
    canStart: canStartVoice,
    getTextVersion,
    getIdentitySnapshot,
    isIdentityCurrent,
    setText,
    requestInputFocus: requestVoiceInputFocus,
  });
  const displayError = lengthError ?? voice.error ?? error;
  const canClearInput = Boolean(
    entryVisible && isExpanded && isWritable && text.length > 0 && !isParsing && !voice.isActive,
  );

  useLayoutEffect(() => {
    if (voiceFocusRequest === 0 || voiceFocusRequest === handledVoiceFocusRequestRef.current) {
      return;
    }
    const input = inputRef.current;
    if (!input || input.disabled) return;
    handledVoiceFocusRequestRef.current = voiceFocusRequest;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [isParsing, text, voice.status, voiceFocusRequest]);

  useLayoutEffect(() => {
    if (!returnFocusToMicrophoneRef.current || voice.isActive) return;
    const microphone = microphoneRef.current;
    returnFocusToMicrophoneRef.current = false;
    if (entryVisible && microphone && !microphone.disabled) microphone.focus();
  }, [entryVisible, voice.isActive]);

  function cancelPendingFocus() {
    if (focusTimeoutRef.current === null) return;
    window.clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = null;
  }

  function collapse() {
    if (voice.isActive) voice.cancel();
    cancelPendingFocus();
    isExpandedRef.current = false;
    setIsExpanded(false);
    toggleRef.current?.focus();
  }

  function expand(focusInput = true) {
    cancelPendingFocus();
    isExpandedRef.current = true;
    setIsExpanded(true);
    if (!focusInput) return;
    // 等原生按鈕的點擊預設行為結束後，再把焦點移進新展開的輸入欄。
    focusTimeoutRef.current = window.setTimeout(() => {
      focusTimeoutRef.current = null;
      if (
        toggleRef.current?.getAttribute('aria-expanded') === 'true' &&
        toggleRef.current.getAttribute('aria-disabled') !== 'true'
      ) {
        inputRef.current?.focus();
      }
    }, 50);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ledger || !isWritable || isParsing || voice.isActive || text.trim() === '') {
      return;
    }
    if ([...text.trim()].length > AI_TEXT_MAX_LENGTH) {
      setLengthError('請精簡至 200 字內。');
      return;
    }

    setLengthError(null);
    voice.clearError();
    if ((await parse(text, ledger.id)) && isExpandedRef.current) collapse();
  }

  function handleEntryKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    if (voice.isActive) {
      event.preventDefault();
      cancelVoiceAndReturnFocus();
      return;
    }
    if (isExpanded && event.target === inputRef.current) {
      event.preventDefault();
      collapse();
    }
  }

  function handleClearInput() {
    if (
      !entryVisible ||
      !isExpandedRef.current ||
      !isWritable ||
      text.length === 0 ||
      isParsing ||
      voice.isActive
    ) {
      return;
    }
    clearSessionInput();
    setLengthError(null);
    voice.clearError();
    inputRef.current?.focus();
  }

  function cancelVoiceAndReturnFocus() {
    returnFocusToMicrophoneRef.current = true;
    voice.cancel();
  }

  if (!element || !isVisible || isLedgerLoading || ledgerError || ledger === undefined) {
    return null;
  }

  const statusText = {
    idle: '',
    preparing: '準備中…',
    listening: '聆聽中…',
    recognizing: '辨識中…',
  }[voice.status];
  const voiceLook =
    voice.status === 'idle' ? 'idle' : voice.status === 'listening' ? 'recording' : 'waiting';
  const microphoneDisabled = isWritable ? voice.status === 'idle' && !canStartVoice : false;

  return createPortal(
    <div
      className={styles.dock}
      data-open={isExpanded}
      data-voice-active={voice.isActive}
      onKeyDown={handleEntryKeyDown}
    >
      <form
        id={inputId}
        className={styles.composer}
        aria-hidden={!isExpanded}
        aria-busy={isParsing || voice.isActive}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <label className={styles.visuallyHidden} htmlFor={`${inputId}-text`}>
          用一句話記帳
        </label>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            id={`${inputId}-text`}
            className={styles.input}
            type="text"
            value={text}
            maxLength={AI_TEXT_MAX_LENGTH}
            placeholder="例如：早餐 60 現金、午餐 120 刷卡"
            disabled={isParsing || voice.isActive}
            tabIndex={isExpanded ? 0 : -1}
            onChange={(event) => {
              setText(event.target.value);
              if ([...event.target.value.trim()].length <= AI_TEXT_MAX_LENGTH) {
                setLengthError(null);
                if (voice.error === '請精簡至 200 字內。') voice.clearError();
              }
            }}
          />
          <button
            className={styles.clearInput}
            type="button"
            aria-label="清除輸入文字"
            hidden={!canClearInput}
            onClick={handleClearInput}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <Button
          type="submit"
          aria-label={isParsing ? '處理中…' : undefined}
          aria-busy={isParsing}
          disabled={!isExpanded || !isWritable || isParsing || voice.isActive || text.trim() === ''}
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
      {voice.isSupported && (
        <button
          ref={microphoneRef}
          className={styles.voiceButton}
          type="button"
          aria-label={voice.status === 'idle' ? '開始語音記帳' : '取消語音'}
          aria-describedby={!isWritable ? tooltipId : undefined}
          aria-disabled={!isWritable || undefined}
          disabled={microphoneDisabled}
          data-error={voice.error !== null}
          data-voice-look={voiceLook}
          data-voice-state={voice.status}
          onClick={() => {
            if (!isWritable) return;
            if (voice.isActive) returnFocusToMicrophoneRef.current = true;
            if (voice.status === 'idle' && canStartVoice && !isExpandedRef.current) expand(false);
            voice.toggle();
          }}
        >
          <span className={styles.voiceGlyph}>
            {voice.status !== 'idle' &&
              (voice.status === 'listening' ? (
                <span className={styles.recordingWaveform} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <span className={styles.voiceActivity} aria-hidden="true" />
              ))}
            <MicrophoneIcon />
            {voice.status !== 'idle' && <CancelMarkIcon />}
          </span>
        </button>
      )}
      <button
        ref={toggleRef}
        className={styles.toggle}
        type="button"
        aria-label={isWritable ? 'AI 記帳' : 'AI 記帳：只能檢視'}
        aria-expanded={isExpanded}
        aria-controls={inputId}
        aria-describedby={!isWritable ? tooltipId : undefined}
        aria-disabled={!isWritable || undefined}
        data-error={displayError !== null}
        onClick={() => {
          if (!isWritable) return;
          if (isExpanded) collapse();
          else expand();
        }}
      >
        <Icon name="sparkle" size={24} />
        {!isWritable && (
          <span id={tooltipId} className={styles.tooltip} role="tooltip">
            只能檢視
          </span>
        )}
      </button>
      <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </span>
      {displayError !== null && (
        <p
          className={isExpanded ? styles.error : styles.visuallyHidden}
          id={errorId}
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
    </div>,
    element,
  );
}

function MicrophoneIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" />
    </svg>
  );
}

function CancelMarkIcon() {
  return (
    <svg
      className={styles.cancelMark}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
