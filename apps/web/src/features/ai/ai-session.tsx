import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  isDraftComplete,
  type CreateTransactionRequest,
  type TransactionDraft,
} from '@ledger/shared';
import { ErrorCode } from '@ledger/shared';
import { ApiError } from '../../lib/api-client';
import { toDateInputValue } from '../../lib/format';
import { useCurrentUser } from '../auth/use-current-user';
import { useAuth } from '../auth/use-auth';
import { useCreateTransactionForLedger } from '../transactions/use-transactions';
import type { AiDraftItem } from './AiDraftList';
import { useAiParse } from './use-ai-parse';

interface AiSessionState {
  text: string;
  error: string | null;
  isParsing: boolean;
  drafts: AiDraftItem[];
  writingKey: string | null;
  busyKeys: ReadonlySet<string>;
  isConfirmingAll: boolean;
}

interface SessionIdentity {
  token: string | null;
  userId: string | null;
  generation: number;
}

export type AiSessionIdentitySnapshot = Readonly<SessionIdentity>;

interface WriteLock {
  id: number;
  key: string;
  owner: 'form' | 'confirm' | 'confirmAll';
  generation: number;
}

interface ConfirmAllRun {
  id: number;
  generation: number;
  token: string | null;
  userId: string | null;
}

interface AiSessionValue extends AiSessionState {
  setText: (text: string) => void;
  clearInput: () => void;
  getTextVersion: () => number;
  getIdentitySnapshot: () => AiSessionIdentitySnapshot;
  isIdentityCurrent: (snapshot: AiSessionIdentitySnapshot) => boolean;
  parse: (text: string, ledgerId: string) => Promise<boolean>;
  confirmDraft: (key: string, editingKey?: string | null) => Promise<boolean>;
  confirmAll: (editingKey: string | null, candidateKeys: readonly string[]) => Promise<void>;
  discardDraft: (key: string) => void;
  markDraftSaving: (key: string, saving: boolean) => boolean;
  removeSavedDraft: (key: string) => void;
}

const EMPTY_STATE: AiSessionState = {
  text: '',
  error: null,
  isParsing: false,
  drafts: [],
  writingKey: null,
  busyKeys: new Set<string>(),
  isConfirmingAll: false,
};

const AiSessionContext = createContext<AiSessionValue | null>(null);

/**
 * AI 草稿與請求鎖跨路由共用，放在 AppProviders 之下、路由之外。
 * 世代與使用者 id 一起隔離非同步回應；右側欄的編輯目標仍由各頁自己持有。
 */
export function AiSessionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const currentUser = useCurrentUser();
  const { parse: requestParse } = useAiParse();
  const createTransaction = useCreateTransactionForLedger();
  const [state, setState] = useState<AiSessionState>(EMPTY_STATE);
  const stateRef = useRef(state);
  const textVersionRef = useRef(0);
  const identityRef = useRef<SessionIdentity>({
    token,
    userId: currentUser.data?.id ?? null,
    generation: 0,
  });
  const parseLockRef = useRef(false);
  const parseRequestIdRef = useRef(0);
  const writeLockRef = useRef<WriteLock | null>(null);
  const nextWriteIdRef = useRef(0);
  const confirmAllRef = useRef<ConfirmAllRun | null>(null);
  const nextConfirmAllIdRef = useRef(0);
  const draftSequenceRef = useRef(0);

  const updateState = useCallback((update: (current: AiSessionState) => AiSessionState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    const userId = currentUser.data?.id ?? null;
    const currentIdentity = identityRef.current;
    if (currentIdentity.token === token && currentIdentity.userId === userId) return;

    identityRef.current = {
      token,
      userId,
      generation: currentIdentity.generation + 1,
    };
    textVersionRef.current += 1;
    parseLockRef.current = false;
    parseRequestIdRef.current += 1;
    confirmAllRef.current = null;

    // 已送出的新增請求仍持有寫入鎖，直到 API 請求真正結束；其餘使用者狀態立即清空。
    const pendingWrite = writeLockRef.current;
    updateState(() => ({
      ...EMPTY_STATE,
      writingKey: pendingWrite?.key ?? null,
      busyKeys: pendingWrite ? new Set([pendingWrite.key]) : new Set<string>(),
    }));
  }, [currentUser.data?.id, token, updateState]);

  const updateText = useCallback(
    (text: string) => {
      if (stateRef.current.text !== text) textVersionRef.current += 1;
      updateState((current) => ({ ...current, text }));
    },
    [updateState],
  );

  const setText = updateText;

  const clearInput = useCallback(() => {
    if (stateRef.current.text !== '') textVersionRef.current += 1;
    updateState((current) => ({ ...current, text: '', error: null }));
  }, [updateState]);

  const getTextVersion = useCallback(() => textVersionRef.current, []);

  const getIdentitySnapshot = useCallback(
    (): AiSessionIdentitySnapshot => ({ ...identityRef.current }),
    [],
  );

  const isCurrentSession = useCallback((snapshot: SessionIdentity) => {
    const current = identityRef.current;
    return (
      current.generation === snapshot.generation &&
      current.token === snapshot.token &&
      current.userId === snapshot.userId
    );
  }, []);

  const parse = useCallback(
    async (text: string, ledgerId: string): Promise<boolean> => {
      const sentence = text.trim();
      const identity = identityRef.current;
      if (parseLockRef.current || sentence === '' || !identity.token || !identity.userId) {
        return false;
      }

      parseLockRef.current = true;
      const requestId = ++parseRequestIdRef.current;
      const snapshot = { ...identity };
      if (stateRef.current.text !== sentence) textVersionRef.current += 1;
      updateState((current) => ({ ...current, text: sentence, error: null, isParsing: true }));

      try {
        const response = await requestParse({
          text: sentence,
          ledgerId,
          today: toDateInputValue(),
        });
        if (!isCurrentSession(snapshot) || parseRequestIdRef.current !== requestId) return false;
        if (response.drafts.length === 0) {
          updateState((current) => ({
            ...current,
            text: sentence,
            error: '看不懂，換個說法再試。',
          }));
          return false;
        }

        const items = response.drafts.map((draft) => {
          draftSequenceRef.current += 1;
          return { key: `ai-draft-${draftSequenceRef.current}`, draft };
        });
        if (stateRef.current.text !== '') textVersionRef.current += 1;
        updateState((current) => ({
          ...current,
          text: '',
          error: null,
          drafts: [...current.drafts, ...items],
        }));
        return true;
      } catch (error) {
        if (!isCurrentSession(snapshot) || parseRequestIdRef.current !== requestId) return false;
        if (stateRef.current.text !== sentence) textVersionRef.current += 1;
        updateState((current) => ({
          ...current,
          text: sentence,
          error: getParseErrorMessage(error),
        }));
        return false;
      } finally {
        if (parseRequestIdRef.current === requestId) {
          parseLockRef.current = false;
          updateState((current) => ({ ...current, isParsing: false }));
        }
      }
    },
    [isCurrentSession, requestParse, updateState],
  );

  const acquireWriteLock = useCallback(
    (key: string, owner: WriteLock['owner']): WriteLock | null => {
      if (writeLockRef.current !== null) return null;
      const lock: WriteLock = {
        id: ++nextWriteIdRef.current,
        key,
        owner,
        generation: identityRef.current.generation,
      };
      writeLockRef.current = lock;
      updateState((current) => ({
        ...current,
        writingKey: key,
        busyKeys: new Set([...current.busyKeys, key]),
      }));
      return lock;
    },
    [updateState],
  );

  const releaseWriteLock = useCallback(
    (lock: WriteLock) => {
      if (writeLockRef.current?.id !== lock.id) return;
      writeLockRef.current = null;
      updateState((current) => {
        const busyKeys = new Set(current.busyKeys);
        busyKeys.delete(lock.key);
        return { ...current, writingKey: null, busyKeys };
      });
    },
    [updateState],
  );

  const writeDraft = useCallback(
    async (
      item: AiDraftItem,
      owner: WriteLock['owner'],
      snapshot: SessionIdentity,
      confirmAllId?: number,
    ): Promise<boolean> => {
      if (!isDraftComplete(item.draft)) return false;
      if (owner === 'confirmAll' && confirmAllRef.current?.id !== confirmAllId) return false;
      if (!isCurrentSession(snapshot)) return false;

      const lock = acquireWriteLock(item.key, owner);
      if (!lock) return false;
      try {
        await createTransaction.mutateAsync({
          ledgerId: item.draft.ledgerId,
          input: draftRequest(item.draft),
        });
        if (!isCurrentSession(snapshot)) return false;
        updateState((current) => ({
          ...current,
          drafts: current.drafts.filter((draftItem) => draftItem.key !== item.key),
        }));
        return true;
      } catch {
        if (isCurrentSession(snapshot)) {
          updateState((current) => ({
            ...current,
            drafts: current.drafts.map((draftItem) =>
              draftItem.key === item.key
                ? { ...draftItem, error: '寫入失敗，請稍後再試。' }
                : draftItem,
            ),
          }));
        }
        return false;
      } finally {
        releaseWriteLock(lock);
      }
    },
    [acquireWriteLock, createTransaction, isCurrentSession, releaseWriteLock, updateState],
  );

  const confirmDraft = useCallback(
    async (key: string, editingKey: string | null = null): Promise<boolean> => {
      const current = stateRef.current;
      if (current.isConfirmingAll || editingKey === key || current.busyKeys.size > 0) return false;
      const item = current.drafts.find((draftItem) => draftItem.key === key);
      if (!item) return false;
      return writeDraft(item, 'confirm', { ...identityRef.current });
    },
    [writeDraft],
  );

  const confirmAll = useCallback(
    async (editingKey: string | null, candidateKeys: readonly string[]): Promise<void> => {
      const current = stateRef.current;
      if (current.isConfirmingAll || current.busyKeys.size > 0 || candidateKeys.length === 0)
        return;

      const eligibleKeys = new Set(candidateKeys);
      const candidates = current.drafts.filter(
        ({ key, draft }) => key !== editingKey && eligibleKeys.has(key) && isDraftComplete(draft),
      );
      if (candidates.length === 0) return;

      const snapshot = { ...identityRef.current };
      const run: ConfirmAllRun = {
        id: ++nextConfirmAllIdRef.current,
        generation: snapshot.generation,
        token: snapshot.token,
        userId: snapshot.userId,
      };
      confirmAllRef.current = run;
      updateState((state) => ({ ...state, isConfirmingAll: true }));

      try {
        for (const item of candidates) {
          const activeRun = confirmAllRef.current;
          if (
            activeRun?.id !== run.id ||
            activeRun.generation !== identityRef.current.generation ||
            activeRun.token !== identityRef.current.token ||
            activeRun.userId !== identityRef.current.userId
          ) {
            break;
          }
          if (!(await writeDraft(item, 'confirmAll', snapshot, run.id))) break;
        }
      } finally {
        if (confirmAllRef.current?.id === run.id) {
          confirmAllRef.current = null;
          updateState((state) => ({ ...state, isConfirmingAll: false }));
        }
      }
    },
    [updateState, writeDraft],
  );

  const discardDraft = useCallback(
    (key: string) => {
      const current = stateRef.current;
      if (current.isConfirmingAll || current.busyKeys.has(key)) return;
      updateState((state) => ({
        ...state,
        drafts: state.drafts.filter((item) => item.key !== key),
      }));
    },
    [updateState],
  );

  const markDraftSaving = useCallback(
    (key: string, saving: boolean): boolean => {
      if (saving) {
        if (stateRef.current.isConfirmingAll) return false;
        return acquireWriteLock(key, 'form') !== null;
      }
      const lock = writeLockRef.current;
      if (lock?.owner === 'form' && lock.key === key) releaseWriteLock(lock);
      return true;
    },
    [acquireWriteLock, releaseWriteLock],
  );

  const removeSavedDraft = useCallback(
    (key: string) => {
      updateState((current) => ({
        ...current,
        drafts: current.drafts.filter((item) => item.key !== key),
      }));
    },
    [updateState],
  );

  const value = useMemo<AiSessionValue>(
    () => ({
      ...state,
      setText,
      clearInput,
      getTextVersion,
      getIdentitySnapshot,
      isIdentityCurrent: isCurrentSession,
      parse,
      confirmDraft,
      confirmAll,
      discardDraft,
      markDraftSaving,
      removeSavedDraft,
    }),
    [
      state,
      setText,
      clearInput,
      getTextVersion,
      getIdentitySnapshot,
      isCurrentSession,
      parse,
      confirmDraft,
      confirmAll,
      discardDraft,
      markDraftSaving,
      removeSavedDraft,
    ],
  );

  return <AiSessionContext.Provider value={value}>{children}</AiSessionContext.Provider>;
}

/** 取得跨頁 AI 草稿狀態；沒有 Provider 時盡早指出掛載位置錯誤。 */
// Provider 與 hook 是同一份跨頁狀態的成對 API，保留在此模組方便依規格掛載。
// eslint-disable-next-line react-refresh/only-export-components
export function useAiSession(): AiSessionValue {
  const context = useContext(AiSessionContext);
  if (!context) throw new Error('useAiSession 必須在 <AiSessionProvider> 內使用。');
  return context;
}

function draftRequest(draft: TransactionDraft): CreateTransactionRequest {
  return {
    type: draft.type,
    amount: draft.amount!,
    date: draft.date!,
    ...(draft.type === 'TRANSFER'
      ? {}
      : draft.categoryId !== null
        ? { categoryId: draft.categoryId }
        : { newCategoryName: draft.newCategoryName! }),
    accountId: draft.accountId!,
    ...(draft.type === 'TRANSFER' ? { toAccountId: draft.toAccountId! } : {}),
    ...(draft.title === null ? {} : { title: draft.title }),
  };
}

function getParseErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'AI 暫時沒有回應，請稍後再試。';
  if (error.errorCode === ErrorCode.AI_DAILY_LIMIT) return '今天的 AI 次數用完了';
  if (error.statusCode === 429 || error.errorCode === ErrorCode.TOO_MANY_REQUESTS) {
    return '太頻繁了，等一分鐘再試。';
  }
  if (error.errorCode === ErrorCode.AI_NOT_CONFIGURED) return 'AI 記帳還沒啟用。';
  if (error.errorCode === ErrorCode.AI_UNAVAILABLE) return 'AI 暫時沒有回應，請稍後再試。';
  return '送出失敗，請稍後再試。';
}
