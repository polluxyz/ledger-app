import { DEFAULT_HOME_LAYOUT_V1 } from '@ledger/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createHomeLayoutEditStore } from './home-layout-edit-store';

/**
 * 這組測試釘住跨頁草稿的生命週期與使用者隔離，並以真實 beforeunload 事件驗證離頁提示。
 */
describe('home layout edit store', () => {
  const stores = new Set<ReturnType<typeof createHomeLayoutEditStore>>();

  afterEach(() => {
    for (const store of stores) store.clearAll();
    stores.clear();
  });

  function createStore() {
    const store = createHomeLayoutEditStore();
    stores.add(store);
    return store;
  }

  function start(store: ReturnType<typeof createHomeLayoutEditStore>, userId = 'user-a') {
    store.activateUser(userId);
    store.startEditing(userId, 4, null, DEFAULT_HOME_LAYOUT_V1);
    return store.getSnapshot(userId)!;
  }

  it('keeps the same user draft while the home route unmounts and mounts again', () => {
    const store = createStore();
    const session = start(store);

    store.updateDraft(session.userId, session.generation, {
      bands: [{ root: { type: 'card', cardId: 'expense' }, extraHeightPx: 12 }],
    });
    store.activateUser('user-a');

    expect(store.getSnapshot('user-a')).toMatchObject({
      isEditing: true,
      revision: 4,
      isDirty: true,
    });
  });

  it('clears the session after a successful save or an explicit cancel', () => {
    const saved = createStore();
    const savedSession = start(saved);
    expect(saved.complete('user-a', savedSession.generation)).toBe(true);
    expect(saved.getSnapshot('user-a')).toBeNull();

    const cancelled = createStore();
    const cancelledSession = start(cancelled);
    const previousGeneration = cancelledSession.generation;
    cancelled.cancel('user-a');
    expect(cancelled.getSnapshot('user-a')).toBeNull();
    expect(cancelled.isCurrentGeneration('user-a', previousGeneration)).toBe(false);
  });

  it('isolates snapshots by user and clears the previous user on a switch or logout', () => {
    const store = createStore();
    const previous = start(store);
    store.activateUser('user-b');

    expect(store.getSnapshot('user-a')).toBeNull();
    expect(store.getSnapshot('user-b')).toBeNull();

    store.startEditing('user-b', 1, null, DEFAULT_HOME_LAYOUT_V1);
    expect(store.getSnapshot('user-a')).toBeNull();
    expect(store.getSnapshot('user-b')?.userId).toBe('user-b');
    expect(store.isCurrentGeneration('user-a', previous.generation)).toBe(false);

    store.clearAll();
    expect(store.getSnapshot('user-b')).toBeNull();
  });

  it('aborts tracked requests and rejects late results after cancel, logout, or user switch', () => {
    const store = createStore();
    const session = start(store);
    const controller = new AbortController();
    store.trackRequest('user-a', session.generation, controller);
    store.cancel('user-a');
    expect(controller.signal.aborted).toBe(true);
    expect(store.isCurrentGeneration('user-a', session.generation)).toBe(false);

    const next = start(store);
    const logoutController = new AbortController();
    store.trackRequest('user-a', next.generation, logoutController);
    store.clearAll();
    expect(logoutController.signal.aborted).toBe(true);
    expect(store.isCurrentGeneration('user-a', next.generation)).toBe(false);
  });

  it('only prevents beforeunload while a draft has changes', () => {
    const store = createStore();
    const session = start(store);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    store.updateDraft(session.userId, session.generation, {
      bands: [{ root: { type: 'card', cardId: 'expense' }, extraHeightPx: 1 }],
    });
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    store.complete(session.userId, session.generation);
    const finishedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(finishedEvent);
    expect(finishedEvent.defaultPrevented).toBe(false);
  });

  it('rejects duplicate saves and draft changes while a save is in progress', () => {
    const store = createStore();
    const session = start(store);
    const draft = {
      bands: [{ root: { type: 'card' as const, cardId: 'expense' as const }, extraHeightPx: 1 }],
    };
    store.updateDraft(session.userId, session.generation, draft);

    expect(store.setSaving(session.userId, session.generation, true)).toBe(true);
    expect(store.setSaving(session.userId, session.generation, true)).toBe(false);
    expect(store.updateDraft(session.userId, session.generation, DEFAULT_HOME_LAYOUT_V1)).toBe(
      false,
    );
    expect(store.resetDraft(session.userId, session.generation, DEFAULT_HOME_LAYOUT_V1)).toBe(
      false,
    );
    expect(store.getSnapshot(session.userId)).toMatchObject({
      draft,
      isDirty: true,
      isSaving: true,
    });
  });
});
