import { LlmProviderError, type LlmTimings } from './llm-provider';

const MAX_RESPONSE_BYTES = 64 * 1024;

interface TransportOptions {
  url: string;
  body: Record<string, unknown>;
  getBearerToken: () => Promise<string>;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

interface TransportResponse {
  status: number;
  /** null 表示超過大小上限，不能再解析內容或用量。 */
  text: string | null;
  timings: LlmTimings;
}

/** 共用安全傳輸；認證、標頭與 body 共用期限，原始例外不跨越此邊界。 */
export async function sendLlmHttpRequest(options: TransportOptions): Promise<TransportResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timings: LlmTimings = {};
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new LlmProviderError('timeout', null, Date.now() - startedAt, { ...timings }));
    }, options.timeoutMs);
  });

  const operation = async (): Promise<TransportResponse> => {
    let token: string;
    try {
      const pendingToken = options.getBearerToken();
      // GoogleAuth 不收 AbortSignal；逾時後的背景認證失敗也必須被接住，不能外洩。
      void pendingToken.catch(() => undefined);
      token = await Promise.race([pendingToken, deadline]);
      if (!token.trim()) throw new Error('Empty access token');
    } catch {
      if (timedOut)
        throw new LlmProviderError('timeout', null, Date.now() - startedAt, { ...timings });
      timings.tokenMs = Date.now() - startedAt;
      // 認證例外可能含金鑰路徑與 email，連 cause 都不能保留。
      throw new LlmProviderError('auth', null, timings.tokenMs, { ...timings });
    }
    timings.tokenMs = Date.now() - startedAt;
    if (timedOut || timings.tokenMs >= options.timeoutMs) {
      throw new LlmProviderError('timeout', null, Date.now() - startedAt, { ...timings });
    }
    const response = await (options.fetchImplementation ?? fetch)(options.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
      redirect: 'error',
      signal: controller.signal,
    });
    timings.headersMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new LlmProviderError('http', response.status, Date.now() - startedAt, { ...timings });
    }
    const text = await readResponseBody(response, controller);
    timings.bodyMs = Date.now() - startedAt;
    return { status: response.status, text, timings: { ...timings } };
  };

  try {
    // fetch 或測試的 body 即使不理會 AbortSignal，也不能讓呼叫者超過期限。
    return await Promise.race([operation(), deadline]);
  } catch (error: unknown) {
    if (error instanceof LlmProviderError) throw error;
    throw new LlmProviderError(timedOut ? 'timeout' : 'network', null, Date.now() - startedAt, {
      ...timings,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** 逐塊累計 byte 數，避免超大回應先被完整讀進記憶體。 */
async function readResponseBody(
  response: Response,
  controller: AbortController,
): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      controller.abort();
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
