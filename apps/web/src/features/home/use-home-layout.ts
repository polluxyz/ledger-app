import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_HOME_LAYOUT_V1, parseHomeLayoutV1 } from '@ledger/shared';
import type { HomeLayoutResponse, HomeLayoutV1, PutHomeLayoutRequest } from '@ledger/shared';
import { homeLayoutEditStore } from '../../app/home-layout-edit-store';
import { apiRequest } from '../../lib/api-client';
import {
  getLatestHomeLayout,
  isSameSavedLayout,
  saveHomeLayoutWithRecovery,
} from './home-layout-save';
import type { HomeLayoutSaveResult } from './home-layout-save';
import { useHomeViewportIsNarrow } from './use-home-viewport';

export const HOME_LAYOUT_QUERY_KEY = ['home-layout', 'web'] as const;
const HOME_LAYOUT_ENDPOINT = '/users/me/home-layout/web';

/**
 * 載入並編輯目前使用者的首頁版面。查詢只在桌機且已有帳本時啟用；寫入狀態放在 App 層，
 * 使換頁與切帳本不會換掉原始 revision 或草稿。
 */
export function useHomeLayout(userId: string | null, hasLedger: boolean) {
  const queryClient = useQueryClient();
  const isNarrow = useHomeViewportIsNarrow();
  const activeUserId = useSyncExternalStore(
    homeLayoutEditStore.subscribe,
    homeLayoutEditStore.getActiveUserId,
    homeLayoutEditStore.getActiveUserId,
  );
  const query = useQuery({
    queryKey: HOME_LAYOUT_QUERY_KEY,
    queryFn: async ({ signal }) =>
      normalizeHomeLayoutResponse(
        await apiRequest<HomeLayoutResponse>(HOME_LAYOUT_ENDPOINT, { signal }),
      ),
    enabled: Boolean(userId && activeUserId === userId && hasLedger && !isNarrow),
    staleTime: Infinity,
    retry: false,
  });
  const session = useSyncExternalStore(
    homeLayoutEditStore.subscribe,
    () => homeLayoutEditStore.getSnapshot(userId),
    () => homeLayoutEditStore.getSnapshot(userId),
  );

  useEffect(() => {
    if (!userId) return;
    // 查詢鍵依規格不帶 user id，因此切換身分時先移除前一位使用者的快取再啟用新查詢。
    if (activeUserId !== null && activeUserId !== userId) {
      queryClient.removeQueries({ queryKey: HOME_LAYOUT_QUERY_KEY });
    }
    homeLayoutEditStore.activateUser(userId);
  }, [activeUserId, queryClient, userId]);

  const startEditing = useCallback(() => {
    if (!userId || !query.data || isNarrow) return;
    const layout = query.data.layout ?? DEFAULT_HOME_LAYOUT_V1;
    homeLayoutEditStore.startEditing(userId, query.data.revision, query.data.layout, layout);
  }, [isNarrow, query.data, userId]);

  const cancelEditing = useCallback(() => {
    if (userId) homeLayoutEditStore.cancel(userId);
  }, [userId]);

  const resetDraft = useCallback(() => {
    if (!userId || !session || isNarrow) return;
    homeLayoutEditStore.resetDraft(userId, session.generation, DEFAULT_HOME_LAYOUT_V1);
  }, [isNarrow, session, userId]);

  const updateDraft = useCallback(
    (layout: HomeLayoutV1) => {
      if (!userId || !session || isNarrow) return;
      homeLayoutEditStore.updateDraft(userId, session.generation, layout);
    },
    [isNarrow, session, userId],
  );

  const saveSession = useCallback(
    async (
      snapshot: NonNullable<typeof session>,
      expectedRevision: number,
      refreshRevision = false,
    ) => {
      if (!userId || snapshot.isSaving) return;
      if (!homeLayoutEditStore.setSaving(userId, snapshot.generation, true)) return;

      const controller = new AbortController();
      const stopTracking = homeLayoutEditStore.trackRequest(
        userId,
        snapshot.generation,
        controller,
      );
      try {
        const submittedLayout = snapshot.resetToDefault ? null : snapshot.draft;
        const services = {
          put: (body: PutHomeLayoutRequest, signal: AbortSignal) =>
            apiRequest<HomeLayoutResponse>(HOME_LAYOUT_ENDPOINT, {
              method: 'PUT',
              body,
              signal,
            }),
          get: (signal: AbortSignal) =>
            apiRequest<HomeLayoutResponse>(HOME_LAYOUT_ENDPOINT, { signal }),
        };
        // 舊分頁的 revision 可能在完整回繞後重複；送出前連同原版面一起比對。
        // 這次網路讀取不會更新草稿基準，GET 到 PUT 的並發仍由後端 revision 把關。
        const latest = await getLatestHomeLayout(services, controller.signal);
        if (!homeLayoutEditStore.isCurrentGeneration(userId, snapshot.generation)) return;
        let result: HomeLayoutSaveResult;
        if (!refreshRevision && isSameSavedLayout(latest.layout, submittedLayout)) {
          result = { kind: 'saved', response: latest };
        } else if (
          !refreshRevision &&
          (latest.revision !== expectedRevision ||
            !isSameSavedLayout(latest.layout, snapshot.initialStoredLayout))
        ) {
          result = { kind: 'conflict', latest };
        } else {
          result = await saveHomeLayoutWithRecovery({
            submittedLayout,
            expectedRevision: refreshRevision ? latest.revision : expectedRevision,
            signal: controller.signal,
            services,
          });
        }
        if (!homeLayoutEditStore.isCurrentGeneration(userId, snapshot.generation)) return;

        if (result.kind === 'saved') {
          queryClient.setQueryData(
            HOME_LAYOUT_QUERY_KEY,
            normalizeHomeLayoutResponse(result.response),
          );
          homeLayoutEditStore.complete(userId, snapshot.generation);
        } else if (result.kind === 'conflict') {
          const latest = normalizeHomeLayoutResponse(result.latest);
          homeLayoutEditStore.setConflict(userId, snapshot.generation, {
            revision: latest.revision,
            layout: latest.layout,
          });
        } else {
          homeLayoutEditStore.setError(userId, snapshot.generation, result.error);
        }
      } catch (error) {
        // 登出、換使用者或取消會先推進世代號碼；舊請求此時不可修改新工作階段。
        if (homeLayoutEditStore.isCurrentGeneration(userId, snapshot.generation)) {
          homeLayoutEditStore.setError(userId, snapshot.generation, error);
        }
      } finally {
        stopTracking();
      }
    },
    [queryClient, userId],
  );

  const finishEditing = useCallback(() => {
    if (!userId || !session || session.isSaving || isNarrow) return;
    if (!session.isDirty) {
      homeLayoutEditStore.complete(userId, session.generation);
      return;
    }
    void saveSession(session, session.revision);
  }, [isNarrow, saveSession, session, userId]);

  const loadLatest = useCallback(() => {
    if (!userId || !session?.conflict) return;
    const response: HomeLayoutResponse = {
      schemaVersion: 1,
      revision: session.conflict.revision,
      layout: session.conflict.layout,
    };
    const layout = response.layout ?? DEFAULT_HOME_LAYOUT_V1;
    homeLayoutEditStore.loadLatest(userId, session.generation, response, layout);
  }, [session, userId]);

  const closeConflict = useCallback(() => {
    if (userId && session) homeLayoutEditStore.closeConflict(userId, session.generation);
  }, [session, userId]);

  const overwriteConflict = useCallback(() => {
    if (!userId || !session?.conflict || session.isSaving || isNarrow) return;
    void saveSession(session, session.conflict.revision, true);
  }, [isNarrow, saveSession, session, userId]);

  return {
    canStartEditing: Boolean(
      userId &&
      activeUserId === userId &&
      hasLedger &&
      !isNarrow &&
      query.data &&
      !session?.isEditing,
    ),
    cancelEditing,
    closeConflict,
    conflict: activeUserId === userId ? (session?.conflict ?? null) : null,
    error: activeUserId === userId ? (session?.error ?? query.error ?? null) : null,
    finishEditing,
    isEditing: Boolean(session?.isEditing && activeUserId === userId && !isNarrow),
    isLoading: query.isLoading,
    isNarrow,
    isPaused: Boolean(session?.isEditing && activeUserId === userId && isNarrow),
    isSaving: Boolean(session?.isSaving && activeUserId === userId),
    layout:
      session?.isEditing && activeUserId === userId
        ? session.draft
        : activeUserId === userId
          ? (query.data?.layout ?? DEFAULT_HOME_LAYOUT_V1)
          : DEFAULT_HOME_LAYOUT_V1,
    loadLatest,
    overwriteConflict,
    resetDraft,
    startEditing,
    updateDraft,
    isDirty: Boolean(session?.isDirty && activeUserId === userId),
  };
}

/** 壞資料在進入 query cache 前收斂成預設語意，避免 renderer 接觸未驗證的樹。 */
export function normalizeHomeLayoutResponse(response: HomeLayoutResponse): HomeLayoutResponse {
  if (response.layout === null) return response;
  const parsed = parseHomeLayoutV1(response.layout);
  return { ...response, layout: parsed.ok ? parsed.layout : null };
}
