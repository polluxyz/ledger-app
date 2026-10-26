import type { HomeLayoutResponse, HomeLayoutV1, PutHomeLayoutRequest } from '@ledger/shared';
import { parseHomeLayoutV1 } from '@ledger/shared';
import { ApiError } from '../../lib/api-client';

/**
 * 儲存版面及處理不確定回應的純流程。PUT 與補查 GET 各自建立逾時 signal，
 * 再用結構比對辨認「伺服器已存、回應卻沒有回來」的情況。
 */

export const HOME_LAYOUT_REQUEST_TIMEOUT_MS = 10_000;

export class HomeLayoutRequestTimeoutError extends Error {
  constructor() {
    super('版面儲存逾時');
    this.name = 'TimeoutError';
  }
}

export type HomeLayoutSaveResult =
  | { kind: 'saved'; response: HomeLayoutResponse }
  | { kind: 'conflict'; latest: HomeLayoutResponse }
  | { kind: 'failed'; error: unknown };

export interface HomeLayoutSaveServices {
  put: (body: PutHomeLayoutRequest, signal: AbortSignal) => Promise<HomeLayoutResponse>;
  get: (signal: AbortSignal) => Promise<HomeLayoutResponse>;
}

export async function saveHomeLayoutWithRecovery({
  services,
  submittedLayout,
  expectedRevision,
  signal,
  timeoutMs = HOME_LAYOUT_REQUEST_TIMEOUT_MS,
}: {
  services: HomeLayoutSaveServices;
  submittedLayout: HomeLayoutV1 | null;
  expectedRevision: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HomeLayoutSaveResult> {
  const body: PutHomeLayoutRequest = {
    schemaVersion: 1,
    expectedRevision,
    layout: submittedLayout,
  };

  try {
    const response = await withRequestTimeout(
      (requestSignal) => services.put(body, requestSignal),
      signal,
      timeoutMs,
    );
    return { kind: 'saved', response };
  } catch (putError) {
    if (signal?.aborted) throw putError;
    if (!shouldReadAfterPutFailure(putError)) return { kind: 'failed', error: putError };

    let latest: HomeLayoutResponse;
    try {
      // 這次 GET 刻意由 service 直接發網路請求，不經 React Query 的快取。
      latest = await getLatestHomeLayout(services, signal, timeoutMs);
    } catch (getError) {
      if (signal?.aborted) throw getError;
      return { kind: 'failed', error: getError };
    }

    if (isSameSavedLayout(latest.layout, submittedLayout))
      return { kind: 'saved', response: latest };
    if (putError instanceof ApiError && putError.statusCode === 409)
      return { kind: 'conflict', latest };
    if (latest.revision > expectedRevision) return { kind: 'conflict', latest };
    return { kind: 'failed', error: putError };
  }
}

/** 直接向後端讀最新版，不碰查詢快取；覆蓋衝突前也會獨立執行這次補查。 */
export function getLatestHomeLayout(
  services: HomeLayoutSaveServices,
  signal?: AbortSignal,
  timeoutMs = HOME_LAYOUT_REQUEST_TIMEOUT_MS,
): Promise<HomeLayoutResponse> {
  return withRequestTimeout((requestSignal) => services.get(requestSignal), signal, timeoutMs);
}

/** null 僅與伺服器的 null 相同；非 null 版面須先通過 parser 再逐節點比較。 */
export function isSameSavedLayout(
  serverLayout: unknown,
  submittedLayout: HomeLayoutV1 | null,
): boolean {
  if (submittedLayout === null) return serverLayout === null;
  if (serverLayout === null || serverLayout === undefined) return false;
  const parsed = parseHomeLayoutV1(serverLayout);
  return parsed.ok && layoutsEqual(parsed.layout, submittedLayout);
}

function shouldReadAfterPutFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.statusCode === 409;
}

function withRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (callback: (value: never) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
      callback(value as never);
    };
    const abortFromParent = () => {
      controller.abort(parentSignal?.reason);
      finish(reject, parentSignal?.reason ?? new DOMException('已取消', 'AbortError'));
    };
    const timeoutId = setTimeout(() => {
      const error = new HomeLayoutRequestTimeoutError();
      controller.abort(error);
      finish(reject, error);
    }, timeoutMs);

    if (parentSignal?.aborted) {
      abortFromParent();
      return;
    }
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });

    Promise.resolve()
      .then(() => request(controller.signal))
      .then((value) => finish(resolve, value))
      .catch((error: unknown) => finish(reject, error));
  });
}

function layoutsEqual(left: HomeLayoutV1, right: HomeLayoutV1): boolean {
  return (
    left.bands.length === right.bands.length &&
    left.bands.every((band, index) => {
      const other = right.bands[index];
      return (
        other !== undefined &&
        band.extraHeightPx === other.extraHeightPx &&
        nodesEqual(band.root, other.root)
      );
    })
  );
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
