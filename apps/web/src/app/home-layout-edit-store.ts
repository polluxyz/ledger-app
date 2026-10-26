import type { HomeLayoutResponse, HomeLayoutV1 } from '@ledger/shared';

/**
 * 首頁可能在使用者離開後卸載，因此把編輯工作階段放在 App 層的記憶體 store。
 * store 以使用者 id 隔離草稿，並集中管理取消、登出與晚到請求的世代檢查。
 */

export interface HomeLayoutConflict {
  revision: number;
  layout: HomeLayoutV1 | null;
}

export interface HomeLayoutEditSnapshot {
  userId: string;
  draft: HomeLayoutV1;
  revision: number;
  initialLayout: HomeLayoutV1;
  initialStoredLayout: HomeLayoutV1 | null;
  isEditing: boolean;
  isDirty: boolean;
  generation: number;
  isSaving: boolean;
  resetToDefault: boolean;
  error: unknown;
  conflict: HomeLayoutConflict | null;
}

type StoreListener = () => void;

export function createHomeLayoutEditStore() {
  const sessions = new Map<string, HomeLayoutEditSnapshot>();
  const generations = new Map<string, number>();
  const controllers = new Map<string, Set<AbortController>>();
  const listeners = new Set<StoreListener>();
  let activeUserId: string | null = null;
  let listeningForUnload = false;

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (![...sessions.values()].some((session) => session.isDirty)) return;
    event.preventDefault();
    event.returnValue = '';
  };

  function emit() {
    for (const listener of listeners) listener();
    syncBeforeUnloadListener();
  }

  function syncBeforeUnloadListener() {
    if (typeof window === 'undefined') return;
    const shouldListen = [...sessions.values()].some((session) => session.isDirty);
    if (shouldListen === listeningForUnload) return;
    listeningForUnload = shouldListen;
    if (shouldListen) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function currentGeneration(userId: string): number {
    return generations.get(userId) ?? 0;
  }

  function abortRequests(userId: string) {
    const activeControllers = controllers.get(userId);
    if (!activeControllers) return;
    for (const controller of activeControllers) controller.abort();
    controllers.delete(userId);
  }

  function invalidateUser(userId: string) {
    generations.set(userId, currentGeneration(userId) + 1);
    abortRequests(userId);
    sessions.delete(userId);
  }

  function getSnapshot(userId: string | null): HomeLayoutEditSnapshot | null {
    return userId ? (sessions.get(userId) ?? null) : null;
  }

  function getActiveUserId() {
    return activeUserId;
  }

  function subscribe(listener: StoreListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function activateUser(userId: string | null) {
    if (activeUserId === userId) return;
    if (activeUserId) invalidateUser(activeUserId);
    activeUserId = userId;
    emit();
  }

  function startEditing(
    userId: string,
    revision: number,
    storedLayout: HomeLayoutV1 | null,
    effectiveLayout: HomeLayoutV1,
  ) {
    if (activeUserId !== userId || sessions.has(userId)) return;
    const generation = currentGeneration(userId);
    sessions.set(userId, {
      userId,
      draft: effectiveLayout,
      revision,
      initialLayout: effectiveLayout,
      initialStoredLayout: storedLayout,
      isEditing: true,
      isDirty: false,
      generation,
      isSaving: false,
      resetToDefault: false,
      error: null,
      conflict: null,
    });
    emit();
  }

  function updateSession(
    userId: string,
    generation: number,
    update: (session: HomeLayoutEditSnapshot) => HomeLayoutEditSnapshot,
  ) {
    const current = sessions.get(userId);
    if (
      !current ||
      activeUserId !== userId ||
      current.generation !== generation ||
      current.isSaving
    ) {
      return false;
    }
    sessions.set(userId, update(current));
    emit();
    return true;
  }

  function updateDraft(userId: string, generation: number, draft: HomeLayoutV1) {
    return updateSession(userId, generation, (session) => ({
      ...session,
      draft,
      resetToDefault: false,
      isDirty: !layoutsEqual(session.initialLayout, draft),
      error: null,
    }));
  }

  function resetDraft(userId: string, generation: number, defaultLayout: HomeLayoutV1) {
    return updateSession(userId, generation, (session) => ({
      ...session,
      draft: defaultLayout,
      resetToDefault: true,
      isDirty: session.initialStoredLayout !== null,
      error: null,
    }));
  }

  function setSaving(userId: string, generation: number, isSaving: boolean) {
    const current = sessions.get(userId);
    if (
      !current ||
      activeUserId !== userId ||
      current.generation !== generation ||
      (current.isSaving && isSaving)
    ) {
      return false;
    }
    sessions.set(userId, { ...current, isSaving, error: isSaving ? null : current.error });
    emit();
    return true;
  }

  function setError(userId: string, generation: number, error: unknown) {
    const current = sessions.get(userId);
    if (!current || current.generation !== generation || activeUserId !== userId) return false;
    sessions.set(userId, { ...current, isSaving: false, error, conflict: null });
    emit();
    return true;
  }

  function setConflict(userId: string, generation: number, latest: HomeLayoutConflict) {
    const current = sessions.get(userId);
    if (!current || current.generation !== generation || activeUserId !== userId) return false;
    sessions.set(userId, { ...current, isSaving: false, error: null, conflict: latest });
    emit();
    return true;
  }

  function closeConflict(userId: string, generation: number) {
    const current = sessions.get(userId);
    if (!current || current.generation !== generation || activeUserId !== userId) return false;
    sessions.set(userId, { ...current, conflict: null });
    emit();
    return true;
  }

  function loadLatest(
    userId: string,
    generation: number,
    latest: HomeLayoutResponse,
    effective: HomeLayoutV1,
  ) {
    const current = sessions.get(userId);
    if (!current || current.generation !== generation || activeUserId !== userId) return false;
    sessions.set(userId, {
      ...current,
      draft: effective,
      revision: latest.revision,
      initialLayout: effective,
      initialStoredLayout: latest.layout,
      isDirty: false,
      resetToDefault: false,
      isSaving: false,
      error: null,
      conflict: null,
    });
    emit();
    return true;
  }

  function isCurrentGeneration(userId: string, generation: number) {
    const current = sessions.get(userId);
    return Boolean(
      activeUserId === userId &&
      current &&
      current.generation === generation &&
      currentGeneration(userId) === generation,
    );
  }

  function trackRequest(userId: string, generation: number, controller: AbortController) {
    if (!isCurrentGeneration(userId, generation)) {
      controller.abort();
      return () => {};
    }
    const activeControllers = controllers.get(userId) ?? new Set<AbortController>();
    activeControllers.add(controller);
    controllers.set(userId, activeControllers);
    return () => {
      activeControllers.delete(controller);
      if (activeControllers.size === 0) controllers.delete(userId);
    };
  }

  function complete(userId: string, generation: number) {
    const current = sessions.get(userId);
    if (!current || current.generation !== generation || activeUserId !== userId) return false;
    sessions.delete(userId);
    emit();
    return true;
  }

  function cancel(userId: string) {
    if (!sessions.has(userId) && !controllers.has(userId)) return;
    invalidateUser(userId);
    emit();
  }

  function clearAll() {
    const userIds = new Set([...sessions.keys(), ...controllers.keys()]);
    if (activeUserId) userIds.add(activeUserId);
    for (const userId of userIds) invalidateUser(userId);
    activeUserId = null;
    emit();
  }

  return {
    activateUser,
    cancel,
    clearAll,
    closeConflict,
    complete,
    getActiveUserId,
    getSnapshot,
    isCurrentGeneration,
    loadLatest,
    resetDraft,
    setConflict,
    setError,
    setSaving,
    startEditing,
    subscribe,
    trackRequest,
    updateDraft,
  };
}

function layoutsEqual(left: HomeLayoutV1, right: HomeLayoutV1): boolean {
  if (left.bands.length !== right.bands.length) return false;
  return left.bands.every((band, index) => {
    const other = right.bands[index];
    return (
      Boolean(other) &&
      band.extraHeightPx === other!.extraHeightPx &&
      nodesEqual(band.root, other!.root)
    );
  });
}

function nodesEqual(
  left: HomeLayoutV1['bands'][number]['root'],
  right: HomeLayoutV1['bands'][number]['root'],
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'card' && right.type === 'card') return left.cardId === right.cardId;
  if (left.type !== 'split' || right.type !== 'split') return false;
  return (
    left.axis === right.axis &&
    left.weights.length === right.weights.length &&
    left.weights.every((weight, index) => weight === right.weights[index]) &&
    left.children.length === right.children.length &&
    left.children.every((child, index) => {
      const other = right.children[index];
      return other !== undefined && nodesEqual(child, other);
    })
  );
}

export const homeLayoutEditStore = createHomeLayoutEditStore();
