import { DEFAULT_HOME_LAYOUT_V1 } from '@ledger/shared';
import type { HomeLayoutResponse, PutHomeLayoutRequest } from '@ledger/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import {
  HomeLayoutRequestTimeoutError,
  isSameSavedLayout,
  saveHomeLayoutWithRecovery,
} from './home-layout-save';

/**
 * 這組測試驗證 jsonb 鍵順序無關的版面比對，以及儲存失敗後四條補查分支。
 */
describe('home layout save recovery', () => {
  it('compares structure without relying on object key order', () => {
    const reordered = {
      bands: DEFAULT_HOME_LAYOUT_V1.bands.map(({ root, extraHeightPx }) => ({
        extraHeightPx,
        root:
          root.type === 'card'
            ? { cardId: root.cardId, type: root.type }
            : {
                weights: [...root.weights],
                children: root.children.map((child) =>
                  child.type === 'card' ? { cardId: child.cardId, type: child.type } : child,
                ),
                axis: root.axis,
                type: root.type,
              },
      })),
    };
    expect(isSameSavedLayout(reordered, DEFAULT_HOME_LAYOUT_V1)).toBe(true);
  });

  it('treats different cards, weights, and null representations as different', () => {
    expect(isSameSavedLayout(null, DEFAULT_HOME_LAYOUT_V1)).toBe(false);
    expect(isSameSavedLayout(DEFAULT_HOME_LAYOUT_V1, null)).toBe(false);
    expect(isSameSavedLayout(null, null)).toBe(true);
    expect(
      isSameSavedLayout(
        { bands: [{ root: { type: 'card', cardId: 'expense' }, extraHeightPx: 0 }] },
        DEFAULT_HOME_LAYOUT_V1,
      ),
    ).toBe(false);
    expect(
      isSameSavedLayout(
        {
          ...DEFAULT_HOME_LAYOUT_V1,
          bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
            index === 0 && band.root.type === 'split'
              ? { ...band, root: { ...band.root, weights: [3334, 3333, 3333] } }
              : band,
          ),
        },
        DEFAULT_HOME_LAYOUT_V1,
      ),
    ).toBe(false);
  });

  it('does not send another request when the first PUT already succeeded', async () => {
    const response = { schemaVersion: 1 as const, revision: 5, layout: DEFAULT_HOME_LAYOUT_V1 };
    const put = vi.fn().mockResolvedValue(response);
    const get = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        revision: 0,
        layout: null,
      }),
    );
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 4,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'saved', response });
    expect(put).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('checks a 409 over the network and treats an identical saved layout as success', async () => {
    const latest = { schemaVersion: 1 as const, revision: 8, layout: DEFAULT_HOME_LAYOUT_V1 };
    const put = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'HOME_LAYOUT_REVISION_CONFLICT', 'conflict'));
    const get = vi.fn((signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(latest);
    });
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 7,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'saved', response: latest });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it('keeps a different 409 version for the conflict dialog', async () => {
    const latest = { schemaVersion: 1 as const, revision: 9, layout: null };
    const put = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'HOME_LAYOUT_REVISION_CONFLICT', 'conflict'));
    const get = vi.fn(() => Promise.resolve(latest));
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 7,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'conflict', latest });
  });

  it('resolves timeout to success when the network GET matches the submitted layout', async () => {
    const latest = { schemaVersion: 1 as const, revision: 6, layout: null };
    const put = vi.fn().mockRejectedValue(new HomeLayoutRequestTimeoutError());
    const get = vi.fn(() => Promise.resolve(latest));
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: null,
        expectedRevision: 5,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'saved', response: latest });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps the original revision on timeout when a different layout still has revision r', async () => {
    const latest = { schemaVersion: 1 as const, revision: 5, layout: null };
    const put = vi.fn((body: PutHomeLayoutRequest) => {
      expect(body.expectedRevision).toBe(5);
      return Promise.reject(new HomeLayoutRequestTimeoutError());
    });
    const get = vi.fn(() => Promise.resolve(latest));
    const result = await saveHomeLayoutWithRecovery({
      services: { put, get },
      submittedLayout: DEFAULT_HOME_LAYOUT_V1,
      expectedRevision: 5,
      timeoutMs: 20,
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed')
      expect(result.error).toBeInstanceOf(HomeLayoutRequestTimeoutError);
  });

  it('opens a conflict when a timeout is followed by a newer different revision', async () => {
    const latest = { schemaVersion: 1 as const, revision: 6, layout: null };
    const put = vi.fn().mockRejectedValue(new HomeLayoutRequestTimeoutError());
    const get = vi.fn(() => Promise.resolve(latest));
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 5,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'conflict', latest });
  });

  it('keeps the draft on a failed recovery GET', async () => {
    const recoveryError = new TypeError('offline');
    const put = vi.fn().mockRejectedValue(new HomeLayoutRequestTimeoutError());
    const get = vi.fn(() => Promise.reject(recoveryError));
    await expect(
      saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 5,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ kind: 'failed', error: recoveryError });
  });

  it('uses its own timeout and signal for the recovery GET', async () => {
    vi.useFakeTimers();
    const put = vi.fn().mockRejectedValue(new TypeError('offline'));
    const get = vi.fn((signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return new Promise<HomeLayoutResponse>(() => {});
    });
    try {
      const result = saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 5,
        timeoutMs: 100,
      });
      await vi.runAllTimersAsync();
      const outcome = await result;
      expect(outcome.kind).toBe('failed');
      if (outcome.kind === 'failed') {
        expect(outcome.error).toBeInstanceOf(HomeLayoutRequestTimeoutError);
      }
      expect(get.mock.calls[0]?.[0].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a timed-out PUT and gives recovery GET its own signal and timeout', async () => {
    vi.useFakeTimers();
    const put = vi.fn((body: PutHomeLayoutRequest, signal: AbortSignal) => {
      expect(body.schemaVersion).toBe(1);
      expect(signal).toBeInstanceOf(AbortSignal);
      return new Promise<HomeLayoutResponse>(() => {});
    });
    const get = vi.fn((signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({
        schemaVersion: 1 as const,
        revision: 6,
        layout: DEFAULT_HOME_LAYOUT_V1,
      });
    });
    try {
      const save = saveHomeLayoutWithRecovery({
        services: { put, get },
        submittedLayout: DEFAULT_HOME_LAYOUT_V1,
        expectedRevision: 5,
        timeoutMs: 100,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);

      await expect(save).resolves.toMatchObject({ kind: 'saved', response: { revision: 6 } });
      const putSignal = put.mock.calls[0]?.[1];
      const getSignal = get.mock.calls[0]?.[0];
      expect(putSignal?.aborted).toBe(true);
      expect(getSignal).toBeInstanceOf(AbortSignal);
      expect(getSignal).not.toBe(putSignal);
      expect(getSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
