import type { ApiErrorResponse } from '@ledger/shared';
import { clearToken, readToken } from './token-storage';

/**
 * 與後端溝通的唯一管道。集中處理三件每個請求都要做的事：
 *   1. 補上 API 位址前綴與 JSON 標頭
 *   2. 附上 Authorization（若已登入）
 *   3. 把後端的統一錯誤格式轉成可預期的 ApiError 丟出
 *
 * 這裡刻意「只負責傳輸」——不做任何業務判斷（金額、權限、一致性一律由後端把關）。
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

/**
 * 後端回傳的錯誤。帶著 `errorCode` 讓呼叫端能分辨「哪一種」失敗，
 * 而不必比對可能變動的人類可讀訊息。
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
    /** 欄位層級訊息；僅驗證失敗時有值。 */
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 未預期的回應（例如後端掛掉回了 HTML）時的保底訊息。 */
const FALLBACK_MESSAGE = '發生未預期的錯誤，請稍後再試。';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 設 true 可略過附帶 token（供登入／註冊等公開端點使用）。 */
  anonymous?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!anonymous) {
    const token = readToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  // 204 No Content（例如 DELETE 成功）沒有 body 可解析。
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * 把失敗的回應轉成 ApiError。401 代表 token 失效或過期，順手清掉本機的
 * token——讓 UI 的「已登入」狀態不會停在一個其實無效的憑證上。
 */
async function toApiError(response: Response): Promise<ApiError> {
  if (response.status === 401) {
    clearToken();
  }

  let payload: Partial<ApiErrorResponse> = {};
  try {
    payload = (await response.json()) as Partial<ApiErrorResponse>;
  } catch {
    // 回應不是 JSON（例如反向代理的錯誤頁）——沿用下方的保底值。
  }

  return new ApiError(
    payload.statusCode ?? response.status,
    payload.errorCode ?? 'UNKNOWN',
    payload.message ?? FALLBACK_MESSAGE,
    payload.details,
  );
}
