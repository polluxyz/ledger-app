import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AI_TEXT_MAX_LENGTH } from '@ledger/shared';
import type { AiSessionIdentitySnapshot } from './ai-session';
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionInstance,
  type SpeechRecognitionResultEvent,
} from './speech-recognition';

export type VoiceInputStatus = 'idle' | 'preparing' | 'listening' | 'recognizing';

interface VoiceInputContext {
  ledgerId: string | undefined;
  isVisible: boolean;
  canStart: boolean;
  getTextVersion: () => number;
  getIdentitySnapshot: () => AiSessionIdentitySnapshot;
  isIdentityCurrent: (snapshot: AiSessionIdentitySnapshot) => boolean;
  setText: (text: string) => void;
  requestInputFocus: () => void;
}

interface VoiceOperation {
  id: number;
  owner: object;
  context: { current: VoiceInputContext };
  ledgerId: string;
  identity: AiSessionIdentitySnapshot;
  textVersion: number;
  recognition: SpeechRecognitionInstance | null;
  delivered: boolean;
  timer: number | null;
  visibilityListener: (() => void) | null;
  cancel: () => void;
}

const PREPARATION_TIMEOUT_MS = 15_000;
const LISTENING_TIMEOUT_MS = 30_000;
const FINAL_RESULT_TIMEOUT_MS = 10_000;

let nextOperationId = 0;
let activeOperation: VoiceOperation | null = null;

/**
 * 管理全站唯一的辨識輪次，讓事件和逾時都只能改動開始時記下的身分、帳本與文字。
 * 每輪建立新的瀏覽器辨識器；辨識只回填文字，不送解析請求。
 */
export function useVoiceInput({
  ledgerId,
  isVisible,
  canStart,
  getTextVersion,
  getIdentitySnapshot,
  isIdentityCurrent,
  setText,
  requestInputFocus,
}: VoiceInputContext) {
  const [status, setStatusState] = useState<VoiceInputStatus>('idle');
  const [error, setErrorState] = useState<string | null>(null);
  const statusRef = useRef<VoiceInputStatus>('idle');
  const mountedRef = useRef(true);
  const ownerRef = useRef<object>({});
  const contextRef = useRef<VoiceInputContext>({
    ledgerId,
    isVisible,
    canStart,
    getTextVersion,
    getIdentitySnapshot,
    isIdentityCurrent,
    setText,
    requestInputFocus,
  });
  const currentContext: VoiceInputContext = {
    ledgerId,
    isVisible,
    canStart,
    getTextVersion,
    getIdentitySnapshot,
    isIdentityCurrent,
    setText,
    requestInputFocus,
  };

  const updateStatus = useCallback((nextStatus: VoiceInputStatus) => {
    statusRef.current = nextStatus;
    if (mountedRef.current) setStatusState(nextStatus);
  }, []);

  const updateError = useCallback((nextError: string | null) => {
    if (mountedRef.current) setErrorState(nextError);
  }, []);

  const isCurrentOperation = useCallback((operation: VoiceOperation) => {
    const context = operation.context.current;
    // 逐項計算，避免操作已失效時略過身分、帳本或輸入版本的檢查。
    const currentId = activeOperation?.id === operation.id;
    const currentIdentity = context.isIdentityCurrent(operation.identity);
    const currentLedger = context.ledgerId === operation.ledgerId;
    const currentTextVersion = context.getTextVersion() === operation.textVersion;
    return currentId && currentIdentity && currentLedger && currentTextVersion;
  }, []);

  const clearTimer = useCallback((operation: VoiceOperation) => {
    if (operation.timer === null) return;
    window.clearTimeout(operation.timer);
    operation.timer = null;
  }, []);

  const clearHandlers = useCallback((operation: VoiceOperation) => {
    if (operation.visibilityListener !== null) {
      document.removeEventListener('visibilitychange', operation.visibilityListener);
      operation.visibilityListener = null;
    }
    if (operation.recognition === null) return;
    operation.recognition.onstart = null;
    operation.recognition.onaudiostart = null;
    operation.recognition.onaudioend = null;
    operation.recognition.onresult = null;
    operation.recognition.onerror = null;
    operation.recognition.onend = null;
  }, []);

  const releaseOperation = useCallback(
    (operation: VoiceOperation, nextError?: string) => {
      if (activeOperation?.id !== operation.id) return;
      activeOperation = null;
      clearTimer(operation);
      clearHandlers(operation);
      updateStatus('idle');
      if (nextError !== undefined) updateError(nextError);
    },
    [clearHandlers, clearTimer, updateError, updateStatus],
  );

  const cancelOperation = useCallback(
    (operation: VoiceOperation) => {
      if (activeOperation?.id !== operation.id) return;
      // 先作廢操作 id，讓 abort 可能同步觸發的事件也無法改動畫面。
      activeOperation = null;
      try {
        operation.recognition?.abort();
      } catch {
        // 瀏覽器若拒絕 abort，這輪仍視為已取消並完成本地清理。
      }
      clearTimer(operation);
      clearHandlers(operation);
      updateStatus('idle');
    },
    [clearHandlers, clearTimer, updateStatus],
  );

  const scheduleTimeout = useCallback(
    (operation: VoiceOperation, durationMs: number, onTimeout: () => void) => {
      clearTimer(operation);
      operation.timer = window.setTimeout(() => {
        operation.timer = null;
        if (!isCurrentOperation(operation)) return;
        onTimeout();
      }, durationMs);
    },
    [clearTimer, isCurrentOperation],
  );

  const beginFinalWait = useCallback(
    (operation: VoiceOperation) => {
      updateStatus('recognizing');
      scheduleTimeout(operation, FINAL_RESULT_TIMEOUT_MS, () => {
        cancelOperation(operation);
        updateError('沒聽清楚，請再試一次。');
      });
    },
    [cancelOperation, scheduleTimeout, updateError, updateStatus],
  );

  const stopOperation = useCallback(
    (operation: VoiceOperation) => {
      if (!isCurrentOperation(operation)) {
        cancelOperation(operation);
        return;
      }
      if (statusRef.current !== 'listening' || operation.recognition === null) return;
      beginFinalWait(operation);
      operation.recognition.stop();
    },
    [beginFinalWait, cancelOperation, isCurrentOperation],
  );

  const start = useCallback(() => {
    const context = contextRef.current;
    if (!context.canStart || !context.isVisible || context.ledgerId === undefined) return;
    if (statusRef.current !== 'idle') return;

    const Recognition = getSpeechRecognitionConstructor();
    if (Recognition === null) return;

    if (activeOperation !== null) activeOperation.cancel();

    const operation: VoiceOperation = {
      id: ++nextOperationId,
      owner: ownerRef.current,
      context: contextRef,
      ledgerId: context.ledgerId,
      identity: context.getIdentitySnapshot(),
      textVersion: context.getTextVersion(),
      recognition: null,
      delivered: false,
      timer: null,
      visibilityListener: null,
      cancel: () => undefined,
    };
    operation.cancel = () => cancelOperation(operation);

    // 同步設好全站鎖，避免雙擊在 React 更新按鈕前建立第二個辨識器。
    activeOperation = operation;
    updateError(null);
    updateStatus('preparing');

    const finishWithoutResult = (message: string) => releaseOperation(operation, message);
    const handleAudioStart = () => {
      if (!isCurrentOperation(operation) || operation.delivered) return;
      clearTimer(operation);
      updateStatus('listening');
      scheduleTimeout(operation, LISTENING_TIMEOUT_MS, () => stopOperation(operation));
    };
    const handleAudioEnd = () => {
      if (!isCurrentOperation(operation) || operation.delivered) return;
      beginFinalWait(operation);
    };
    const handleResult = (event: SpeechRecognitionResultEvent) => {
      if (!isCurrentOperation(operation) || operation.delivered) return;
      const result = event.results.item(0) ?? event.results[0];
      if (!result?.isFinal) return;
      const alternative = result.item(0) ?? result[0];
      if (!alternative) return;

      operation.delivered = true;
      const transcript = alternative.transcript;
      if (transcript.trim() === '') {
        finishWithoutResult('沒聽清楚，請再試一次。');
        return;
      }

      clearTimer(operation);
      const textTooLong = [...transcript.trim()].length > AI_TEXT_MAX_LENGTH;
      contextRef.current.setText(transcript);
      contextRef.current.requestInputFocus();
      releaseOperation(operation, textTooLong ? '請精簡至 200 字內。' : undefined);
    };
    const handleError = (event: SpeechRecognitionErrorEvent) => {
      if (!isCurrentOperation(operation) || operation.delivered) return;
      finishWithoutResult(getSpeechErrorMessage(event.error));
    };
    const handleEnd = () => {
      if (!isCurrentOperation(operation) || operation.delivered) return;
      finishWithoutResult('沒聽清楚，請再試一次。');
    };

    try {
      const recognition = new Recognition();
      operation.recognition = recognition;
      recognition.lang = 'zh-TW';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (!isCurrentOperation(operation)) return;
      };
      recognition.onaudiostart = handleAudioStart;
      recognition.onaudioend = handleAudioEnd;
      recognition.onresult = handleResult;
      recognition.onerror = handleError;
      recognition.onend = handleEnd;

      const handleVisibilityChange = () => {
        if (!isCurrentOperation(operation)) return;
        if (document.visibilityState === 'hidden') cancelOperation(operation);
      };
      operation.visibilityListener = handleVisibilityChange;
      document.addEventListener('visibilitychange', handleVisibilityChange);

      scheduleTimeout(operation, PREPARATION_TIMEOUT_MS, () => {
        cancelOperation(operation);
        updateError('目前無法使用語音，請改用文字。');
      });
      recognition.start();
    } catch {
      releaseOperation(operation, '目前無法使用語音，請改用文字。');
    }
  }, [
    beginFinalWait,
    cancelOperation,
    clearTimer,
    isCurrentOperation,
    releaseOperation,
    scheduleTimeout,
    stopOperation,
    updateError,
    updateStatus,
  ]);

  const cancel = useCallback(() => {
    const operation = activeOperation;
    if (operation?.owner === ownerRef.current) cancelOperation(operation);
  }, [cancelOperation]);

  const toggle = useCallback(() => {
    const operation = activeOperation;
    if (operation?.owner === ownerRef.current) {
      cancelOperation(operation);
      return;
    }
    start();
  }, [cancelOperation, start]);

  const clearError = useCallback(() => updateError(null), [updateError]);

  useLayoutEffect(() => {
    contextRef.current = currentContext;
  });

  useLayoutEffect(() => {
    const operation = activeOperation;
    if (operation?.owner !== ownerRef.current) return;
    const context = contextRef.current;
    if (!context.isVisible || !context.canStart || !isCurrentOperation(operation)) {
      cancelOperation(operation);
    }
  });

  useEffect(() => {
    const owner = ownerRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const operation = activeOperation;
      if (operation?.owner === owner) cancelOperation(operation);
    };
  }, [cancelOperation]);

  return {
    status,
    error,
    isActive: status !== 'idle',
    isSupported: getSpeechRecognitionConstructor() !== null,
    start,
    cancel,
    toggle,
    clearError,
  };
}

function getSpeechErrorMessage(code: string): string {
  if (code === 'not-allowed') return '無法使用麥克風，請檢查權限。';
  if (code === 'no-speech' || code === 'nomatch') return '沒聽清楚，請再試一次。';
  if (code === 'audio-capture') return '無法使用麥克風。';
  if (code === 'network') return '語音服務連線失敗，請再試一次。';
  if (code === 'aborted') return '目前無法使用語音，請改用文字。';
  return '目前無法使用語音，請改用文字。';
}
