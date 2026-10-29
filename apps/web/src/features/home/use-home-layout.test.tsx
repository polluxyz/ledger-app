import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_HOME_LAYOUT_V1 } from '@ledger/shared';
import type { HomeLayoutResponse, HomeLayoutV1, PutHomeLayoutRequest } from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeLayoutEditStore } from '../../app/home-layout-edit-store';
import { ApiError, apiRequest } from '../../lib/api-client';
import {
  HOME_LAYOUT_QUERY_KEY,
  normalizeHomeLayoutResponse,
  useHomeLayout,
} from './use-home-layout';
import { HOME_LAYOUT_REQUEST_TIMEOUT_MS, HomeLayoutRequestTimeoutError } from './home-layout-save';

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiRequest: vi.fn() };
});

const requestApi = vi.mocked(apiRequest);
const originalWindowMatchMedia = window.matchMedia;

function changedWeightLayout(weight: number): HomeLayoutV1 {
  return {
    ...DEFAULT_HOME_LAYOUT_V1,
    bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
      index === 0 && band.root.type === 'split'
        ? { ...band, root: { ...band.root, weights: [weight, 3333, 10000 - weight - 3333] } }
        : band,
    ),
  };
}

/**
 * 這組 hook 測試以網路回應模擬快取、並發與回繞，涵蓋儲存前比對及草稿生命週期。
 */
describe('useHomeLayout', () => {
  let queryClient: QueryClient;
  let narrow = false;
  let mediaListeners: Set<(event: MediaQueryListEvent) => void>;

  beforeEach(() => {
    homeLayoutEditStore.clearAll();
    mediaListeners = new Set();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    requestApi.mockReset();
    narrow = false;
    const matchMedia = createMatchMedia();
    vi.stubGlobal('matchMedia', matchMedia);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
  });

  afterEach(() => {
    homeLayoutEditStore.clearAll();
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalWindowMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalWindowMatchMedia,
      });
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  function createMatchMedia() {
    return vi.fn((media: string) => ({
      get matches() {
        return narrow;
      },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.delete(listener),
      addListener: (listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) =>
        mediaListeners.delete(listener),
      dispatchEvent: vi.fn(),
    }));
  }

  function setNarrow(value: boolean) {
    narrow = value;
    act(() => {
      mediaListeners.forEach((listener) => listener({ matches: value } as MediaQueryListEvent));
    });
  }

  function wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  function mockResponse(response: HomeLayoutResponse) {
    requestApi.mockImplementation(() => Promise.resolve(response));
  }

  it('skips the endpoint on narrow viewports or when there is no ledger', async () => {
    narrow = true;
    requestApi.mockImplementation(() =>
      Promise.resolve({ schemaVersion: 1, revision: 0, layout: null }),
    );
    const narrowHook = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await act(async () => {});
    expect(requestApi).not.toHaveBeenCalled();
    narrowHook.unmount();

    narrow = false;
    const noLedgerHook = renderHook(() => useHomeLayout('user-a', false), { wrapper });
    await act(async () => {});
    expect(requestApi).not.toHaveBeenCalled();
    noLedgerHook.unmount();
  });

  it('uses the default layout when the server response fails validation', async () => {
    mockResponse({
      schemaVersion: 1,
      revision: 2,
      layout: { bands: [{ root: { type: 'card', cardId: 'unknown' }, extraHeightPx: 0 }] } as never,
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });

    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    await waitFor(() => expect(result.current.layout).toEqual(DEFAULT_HOME_LAYOUT_V1));
    expect(
      normalizeHomeLayoutResponse({
        schemaVersion: 1,
        revision: 2,
        layout: { bands: [] },
      }).layout,
    ).toBeNull();
  });

  it('does not PUT when completing without changes', async () => {
    mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(1));

    act(() => result.current.startEditing());
    act(() => result.current.finishEditing());

    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
    expect(requestApi).toHaveBeenCalledTimes(1);
  });

  it('sends layout null when reset to default and completed', async () => {
    const customLayout = {
      ...DEFAULT_HOME_LAYOUT_V1,
      bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
        index === 0 && band.root.type === 'split'
          ? { ...band, root: { ...band.root, weights: [3000, 3500, 3500] } }
          : band,
      ),
    };
    requestApi.mockImplementation((_path, options) => {
      if (options?.method === 'PUT')
        return Promise.resolve({ schemaVersion: 1, revision: 4, layout: null });
      return Promise.resolve({ schemaVersion: 1, revision: 3, layout: customLayout });
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.layout).toEqual(customLayout));

    act(() => result.current.startEditing());
    expect(result.current.isEditing).toBe(true);
    act(() => result.current.resetDraft());
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.finishEditing());
    await waitFor(() => expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull());

    const put = requestApi.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(put?.[0]).toBe('/users/me/home-layout/web');
    expect(put?.[1]?.body).toMatchObject({ expectedRevision: 3, layout: null });
    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
  });

  it('writes a wrapped revision from a successful PUT into the React Query cache', async () => {
    const submittedLayout = changedWeightLayout(3000);
    requestApi.mockImplementation((_path, options) => {
      if (options?.method === 'PUT') {
        expect(options.body).toMatchObject({ expectedRevision: 2147483647 });
        return Promise.resolve({
          schemaVersion: 1,
          revision: 1,
          layout: submittedLayout,
        });
      }
      return Promise.resolve({
        schemaVersion: 1,
        revision: 2147483647,
        layout: DEFAULT_HOME_LAYOUT_V1,
      });
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));

    act(() => result.current.startEditing());
    act(() => result.current.updateDraft(submittedLayout));
    act(() => result.current.finishEditing());
    await waitFor(() => expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull());

    expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toMatchObject({
      revision: 1,
      layout: submittedLayout,
    });
  });

  it.each([7, 8])(
    'preserves the draft without PUT when another tab changed the layout at revision %i',
    async (revision) => {
      const draft = changedWeightLayout(3000);
      const latest = { schemaVersion: 1 as const, revision, layout: changedWeightLayout(3500) };
      let serverResponse: HomeLayoutResponse = {
        schemaVersion: 1,
        revision: 7,
        layout: DEFAULT_HOME_LAYOUT_V1,
      };
      requestApi.mockImplementation((_path, options) =>
        Promise.resolve(
          options?.method === 'PUT'
            ? { schemaVersion: 1, revision: revision + 1, layout: draft }
            : serverResponse,
        ),
      );
      const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
      await waitFor(() => expect(result.current.canStartEditing).toBe(true));
      act(() => result.current.startEditing());
      act(() => result.current.updateDraft(draft));
      // 同 revision 直接模擬另一分頁完整回繞後的狀態，避免執行數十億次更新。
      serverResponse = latest;
      await act(async () => {
        result.current.finishEditing();
        await Promise.resolve();
      });

      expect(result.current.conflict).toEqual({ revision, layout: latest.layout });
      expect(result.current.layout).toEqual(draft);
      expect(result.current.isDirty).toBe(true);
      expect(requestApi.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(
        0,
      );
      expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toMatchObject({ revision: 7 });
    },
  );

  it('requires a conflict when only the revision changed, keeping the original revision', async () => {
    mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    act(() => result.current.startEditing());
    const draft = changedWeightLayout(3000);
    act(() => result.current.updateDraft(draft));
    mockResponse({ schemaVersion: 1, revision: 8, layout: DEFAULT_HOME_LAYOUT_V1 });

    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });

    expect(result.current.conflict?.revision).toBe(8);
    expect(homeLayoutEditStore.getSnapshot('user-a')).toMatchObject({ revision: 7, draft });
    expect(requestApi).toHaveBeenCalledTimes(2);
  });

  it.each([7, 8])(
    'adopts revision %i without PUT when the latest layout matches the draft',
    async (revision) => {
      mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
      const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
      await waitFor(() => expect(result.current.canStartEditing).toBe(true));
      act(() => result.current.startEditing());
      const draft = changedWeightLayout(3000);
      act(() => result.current.updateDraft(draft));
      const latest = { schemaVersion: 1 as const, revision, layout: draft };
      mockResponse(latest);

      await act(async () => {
        result.current.finishEditing();
        await Promise.resolve();
      });

      expect(result.current.isEditing).toBe(false);
      expect(result.current.conflict).toBeNull();
      expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toEqual(latest);
      expect(requestApi).toHaveBeenCalledTimes(2);
      expect(requestApi.mock.calls.every(([, options]) => options?.method !== 'PUT')).toBe(true);
    },
  );

  it.each([
    { initial: null, latest: DEFAULT_HOME_LAYOUT_V1 },
    { initial: DEFAULT_HOME_LAYOUT_V1, latest: null },
  ])(
    'distinguishes null and an explicitly saved default layout before PUT ($initial)',
    async ({ initial, latest }) => {
      mockResponse({ schemaVersion: 1, revision: 7, layout: initial });
      const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
      await waitFor(() => expect(result.current.canStartEditing).toBe(true));
      act(() => result.current.startEditing());
      act(() => result.current.updateDraft(changedWeightLayout(3000)));
      mockResponse({ schemaVersion: 1, revision: 7, layout: latest });

      await act(async () => {
        result.current.finishEditing();
        await Promise.resolve();
      });

      expect(result.current.conflict).toEqual({ revision: 7, layout: latest });
      expect(requestApi).toHaveBeenCalledTimes(2);
    },
  );

  it('recognizes an already saved reset without PUT', async () => {
    mockResponse({ schemaVersion: 1, revision: 7, layout: changedWeightLayout(3000) });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    act(() => result.current.startEditing());
    act(() => result.current.resetDraft());
    mockResponse({ schemaVersion: 1, revision: 8, layout: null });

    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });

    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
    expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toMatchObject({
      revision: 8,
      layout: null,
    });
    expect(requestApi).toHaveBeenCalledTimes(2);
  });

  it('retains the draft on a failed pre-save GET and retries with the original revision', async () => {
    const initial = { schemaVersion: 1 as const, revision: 7, layout: null };
    mockResponse(initial);
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    act(() => result.current.startEditing());
    const draft = changedWeightLayout(3000);
    act(() => result.current.updateDraft(draft));
    const error = new TypeError('offline');
    requestApi.mockRejectedValueOnce(error);

    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });

    expect(result.current.error).toBe(error);
    expect(homeLayoutEditStore.getSnapshot('user-a')).toMatchObject({
      revision: 7,
      draft,
      isDirty: true,
    });
    expect(requestApi).toHaveBeenCalledTimes(2);
    requestApi.mockImplementation((_path, options) =>
      Promise.resolve(
        options?.method === 'PUT' ? { schemaVersion: 1, revision: 8, layout: draft } : initial,
      ),
    );
    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });

    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
    const puts = requestApi.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[1]?.body).toMatchObject({ expectedRevision: 7, layout: draft });
  });

  it('times out the pre-save GET without PUT and ignores its late response', async () => {
    mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    act(() => result.current.startEditing());
    const draft = changedWeightLayout(3000);
    act(() => result.current.updateDraft(draft));
    let resolveGet!: (response: HomeLayoutResponse) => void;
    requestApi.mockImplementation(
      () =>
        new Promise<HomeLayoutResponse>((resolve) => {
          resolveGet = resolve;
        }),
    );
    vi.useFakeTimers();
    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOME_LAYOUT_REQUEST_TIMEOUT_MS);
    });

    expect(result.current.error).toBeInstanceOf(HomeLayoutRequestTimeoutError);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.layout).toEqual(draft);
    expect(requestApi.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    await act(() => Promise.resolve(resolveGet({ schemaVersion: 1, revision: 8, layout: draft })));
    expect(result.current.isEditing).toBe(true);
    expect(requestApi).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel', 'logout', 'switch user'] as const)(
    'ignores a late pre-save GET after %s and freezes changes while waiting',
    async (action) => {
      mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
      const initialProps: { userId: string | null } = { userId: 'user-a' };
      const { result, rerender } = renderHook(({ userId }) => useHomeLayout(userId, true), {
        initialProps,
        wrapper,
      });
      await waitFor(() => expect(result.current.canStartEditing).toBe(true));
      act(() => result.current.startEditing());
      const draft = changedWeightLayout(3000);
      act(() => result.current.updateDraft(draft));
      let resolveGet!: (response: HomeLayoutResponse) => void;
      requestApi.mockImplementation(
        () =>
          new Promise<HomeLayoutResponse>((resolve) => {
            resolveGet = resolve;
          }),
      );
      await act(async () => {
        result.current.finishEditing();
        result.current.finishEditing();
        await Promise.resolve();
      });
      expect(result.current.isSaving).toBe(true);
      act(() => result.current.updateDraft(changedWeightLayout(3500)));
      act(() => result.current.resetDraft());
      expect(result.current.layout).toEqual(draft);
      // 新使用者的查詢用獨立回應，不讓它取代正在等待的舊 GET resolver。
      const newUserResponse = { schemaVersion: 1 as const, revision: 2, layout: null };
      mockResponse(newUserResponse);
      const preSaveSignal = requestApi.mock.calls[1]?.[1]?.signal;
      act(() => {
        if (action === 'cancel') result.current.cancelEditing();
        else {
          if (action === 'logout') homeLayoutEditStore.activateUser(null);
          rerender({ userId: action === 'logout' ? null : 'user-b' });
        }
      });
      await act(() =>
        Promise.resolve(
          resolveGet({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 }),
        ),
      );

      expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
      expect(preSaveSignal?.aborted).toBe(true);
      expect(requestApi.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(
        0,
      );
      expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).not.toMatchObject({ layout: draft });
      if (action === 'switch user') {
        await waitFor(() =>
          expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toEqual(newUserResponse),
        );
        expect(homeLayoutEditStore.getActiveUserId()).toBe('user-b');
      }
    },
  );

  it('uses a fresh direct GET after a network failure instead of the cached query result', async () => {
    const customLayout = {
      ...DEFAULT_HOME_LAYOUT_V1,
      bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
        index === 0 && band.root.type === 'split'
          ? { ...band, root: { ...band.root, weights: [3000, 3500, 3500] } }
          : band,
      ),
    };
    let getCount = 0;
    requestApi.mockImplementation((_path, options) => {
      if (options?.method === 'PUT') return Promise.reject(new TypeError('offline'));
      getCount += 1;
      return Promise.resolve({ schemaVersion: 1, revision: 3, layout: customLayout });
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    const getSignals: AbortSignal[] = [];
    requestApi.mock.calls.forEach(([path, options]) => {
      if (path === '/users/me/home-layout/web' && options?.method !== 'PUT' && options?.signal) {
        getSignals.push(options.signal);
      }
    });
    act(() => result.current.startEditing());
    act(() => result.current.updateDraft(DEFAULT_HOME_LAYOUT_V1));
    act(() => result.current.finishEditing());
    await waitFor(() => expect(result.current.error).toBeInstanceOf(TypeError));

    expect(getCount).toBe(3);
    const signalsAfterSave = requestApi.mock.calls.flatMap(([, options]) =>
      options?.signal ? [options.signal] : [],
    );
    expect(getSignals).toHaveLength(1);
    expect(signalsAfterSave).toHaveLength(4);
    expect(new Set(signalsAfterSave).size).toBe(4);
    expect(queryClient.getQueryData(HOME_LAYOUT_QUERY_KEY)).toMatchObject({
      revision: 3,
      layout: customLayout,
    });
    expect(homeLayoutEditStore.getSnapshot('user-a')?.revision).toBe(3);
    expect(homeLayoutEditStore.getSnapshot('user-a')?.isDirty).toBe(true);
  });

  it('pauses edits at 900px, ignores draft writes while narrow, and resumes the same revision', async () => {
    mockResponse({ schemaVersion: 1, revision: 12, layout: DEFAULT_HOME_LAYOUT_V1 });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));

    act(() => result.current.startEditing());
    const draft = changedWeightLayout(3000);
    act(() => result.current.updateDraft(draft));
    expect(result.current.isDirty).toBe(true);

    setNarrow(true);
    await waitFor(() => expect(result.current.isPaused).toBe(true));
    act(() => result.current.updateDraft(DEFAULT_HOME_LAYOUT_V1));
    act(() => result.current.resetDraft());
    expect(homeLayoutEditStore.getSnapshot('user-a')).toMatchObject({
      draft,
      revision: 12,
      isDirty: true,
    });

    setNarrow(false);
    await waitFor(() => expect(result.current.isEditing).toBe(true));
    expect(result.current.layout).toEqual(draft);
    expect(homeLayoutEditStore.getSnapshot('user-a')?.revision).toBe(12);
    expect(requestApi).toHaveBeenCalledTimes(1);
  });

  it('clears the previous user session and fetches fresh data when the user changes', async () => {
    const userALayout = changedWeightLayout(3000);
    const userBLayout = changedWeightLayout(3500);
    let getCount = 0;
    requestApi.mockImplementation(() => {
      getCount += 1;
      return Promise.resolve({
        schemaVersion: 1,
        revision: getCount,
        layout: getCount === 1 ? userALayout : userBLayout,
      });
    });
    const { result, rerender } = renderHook(({ userId }) => useHomeLayout(userId, true), {
      initialProps: { userId: 'user-a' },
      wrapper,
    });
    await waitFor(() => expect(result.current.layout).toEqual(userALayout));

    act(() => result.current.startEditing());
    expect(homeLayoutEditStore.getSnapshot('user-a')?.isEditing).toBe(true);
    rerender({ userId: 'user-b' });

    await waitFor(() => expect(result.current.layout).toEqual(userBLayout));
    expect(getCount).toBe(2);
    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
    expect(result.current.canStartEditing).toBe(true);
  });

  it('loads the latest revision from a conflict and completes cleanly without a second PUT', async () => {
    const latestLayout = changedWeightLayout(3500);
    let getCount = 0;
    let putCount = 0;
    requestApi.mockImplementation((_path, options) => {
      if (options?.method === 'PUT') {
        putCount += 1;
        return Promise.reject(new ApiError(409, 'HOME_LAYOUT_REVISION_CONFLICT', 'conflict'));
      }
      getCount += 1;
      return Promise.resolve(
        getCount <= 2
          ? { schemaVersion: 1, revision: 3, layout: DEFAULT_HOME_LAYOUT_V1 }
          : { schemaVersion: 1, revision: 4, layout: latestLayout },
      );
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));

    act(() => result.current.startEditing());
    act(() => result.current.updateDraft(changedWeightLayout(3000)));
    act(() => result.current.finishEditing());
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.conflict).toMatchObject({ revision: 4, layout: latestLayout });

    act(() => result.current.loadLatest());
    expect(result.current.layout).toEqual(latestLayout);
    expect(result.current.isDirty).toBe(false);
    expect(homeLayoutEditStore.getSnapshot('user-a')?.revision).toBe(4);
    act(() => result.current.finishEditing());
    expect(putCount).toBe(1);
  });

  it('uses the loaded conflict as the original layout for a subsequent save', async () => {
    mockResponse({ schemaVersion: 1, revision: 7, layout: DEFAULT_HOME_LAYOUT_V1 });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));
    act(() => result.current.startEditing());
    act(() => result.current.updateDraft(changedWeightLayout(3000)));
    const latest = { schemaVersion: 1 as const, revision: 8, layout: changedWeightLayout(3500) };
    mockResponse(latest);
    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });
    expect(result.current.conflict?.revision).toBe(8);
    act(() => result.current.loadLatest());
    const draft = changedWeightLayout(4000);
    act(() => result.current.updateDraft(draft));
    requestApi.mockImplementation((_path, options) =>
      Promise.resolve(
        options?.method === 'PUT' ? { schemaVersion: 1, revision: 9, layout: draft } : latest,
      ),
    );

    await act(async () => {
      result.current.finishEditing();
      await Promise.resolve();
    });

    expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull();
    const puts = requestApi.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[1]?.body).toMatchObject({ expectedRevision: 8, layout: draft });
  });

  it('overwrites a conflict using a fresh revision and rejects duplicate submission', async () => {
    const submittedLayout = changedWeightLayout(3000);
    const conflictingLayout = changedWeightLayout(3500);
    let getCount = 0;
    const putBodies: Array<{ expectedRevision: number; layout: HomeLayoutV1 | null }> = [];
    requestApi.mockImplementation((_path, options) => {
      if (options?.method === 'PUT') {
        const body = options.body as PutHomeLayoutRequest;
        putBodies.push(body);
        if (putBodies.length === 1) {
          return Promise.reject(new ApiError(409, 'HOME_LAYOUT_REVISION_CONFLICT', 'conflict'));
        }
        return Promise.resolve({ schemaVersion: 1, revision: 6, layout: submittedLayout });
      }
      getCount += 1;
      if (getCount <= 2)
        return Promise.resolve({ schemaVersion: 1, revision: 3, layout: DEFAULT_HOME_LAYOUT_V1 });
      if (getCount === 3)
        return Promise.resolve({ schemaVersion: 1, revision: 4, layout: conflictingLayout });
      return Promise.resolve({ schemaVersion: 1, revision: 5, layout: conflictingLayout });
    });
    const { result } = renderHook(() => useHomeLayout('user-a', true), { wrapper });
    await waitFor(() => expect(result.current.canStartEditing).toBe(true));

    act(() => result.current.startEditing());
    act(() => result.current.updateDraft(submittedLayout));
    act(() => result.current.finishEditing());
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.conflict?.revision).toBe(4);

    act(() => {
      result.current.overwriteConflict();
      result.current.overwriteConflict();
    });
    await waitFor(() => expect(putBodies).toHaveLength(2));
    await waitFor(() => expect(homeLayoutEditStore.getSnapshot('user-a')).toBeNull());

    expect(getCount).toBe(4);
    expect(putBodies[1]).toEqual({
      schemaVersion: 1,
      expectedRevision: 5,
      layout: submittedLayout,
    });
  });
});
