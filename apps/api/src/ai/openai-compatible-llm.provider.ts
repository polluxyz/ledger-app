import {
  LlmProviderError,
  type LLMProvider,
  type LlmProviderDescriptor,
  type LlmRequest,
  type LlmResponse,
  type LlmTimings,
} from './llm-provider';

const MAX_RESPONSE_BYTES = 64 * 1024;

interface ProviderOptions {
  descriptor: LlmProviderDescriptor;
  url: string;
  model: string;
  getBearerToken: () => Promise<string>;
  timeoutMs: number;
  reasoningEffort?: 'low' | 'high' | 'max';
  fetchImplementation?: typeof fetch;
}

/** 共用 OpenAI 相容傳輸；認證、標頭與 body 共用同一個期限，原始例外不跨越此邊界。 */
export class OpenAiCompatibleLlmProvider implements LLMProvider {
  readonly descriptor: LlmProviderDescriptor;

  constructor(private readonly options: ProviderOptions) {
    this.descriptor = options.descriptor;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
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
      }, this.options.timeoutMs);
    });

    const operation = async (): Promise<LlmResponse> => {
      let token: string;
      try {
        const pendingToken = this.options.getBearerToken();
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
      if (timedOut || timings.tokenMs >= this.options.timeoutMs) {
        throw new LlmProviderError('timeout', null, Date.now() - startedAt, { ...timings });
      }
      const response = await (this.options.fetchImplementation ?? fetch)(this.options.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: request.maxOutputTokens,
          messages: [
            {
              role: 'system',
              content: `${request.system}\n\nJSON schema:\n${JSON.stringify(request.schema)}`,
            },
            { role: 'user', content: request.user },
          ],
          stream: false,
          response_format: { type: 'json_object' },
          ...(this.options.reasoningEffort
            ? { reasoning_effort: this.options.reasoningEffort }
            : {}),
        }),
        redirect: 'error',
        signal: controller.signal,
      });
      timings.headersMs = Date.now() - startedAt;
      if (!response.ok) {
        throw new LlmProviderError('http', response.status, Date.now() - startedAt, { ...timings });
      }
      const responseText = await this.readResponseBody(response, controller);
      timings.bodyMs = Date.now() - startedAt;
      const empty = { content: null, truncated: false, timings: { ...timings } };
      if (responseText === null) return empty;
      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        return empty;
      }
      const usage = this.getUsage(payload);
      const truncated = this.getFinishReason(payload) === 'length';
      const result = {
        content: null,
        truncated,
        ...(usage ? { usage } : {}),
        timings: { ...timings },
      };
      const messageContent = this.getMessageContent(payload);
      if (typeof messageContent !== 'string') return result;
      try {
        return { ...result, content: JSON.parse(messageContent) as unknown };
      } catch {
        return result;
      }
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
  private async readResponseBody(
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

  private getMessageContent(payload: unknown): unknown {
    if (!this.isRecord(payload) || !Array.isArray(payload['choices'])) return null;
    const choice: unknown = payload['choices'][0];
    return this.isRecord(choice) && this.isRecord(choice['message'])
      ? choice['message']['content']
      : null;
  }

  private getUsage(payload: unknown): LlmResponse['usage'] {
    if (!this.isRecord(payload) || !this.isRecord(payload['usage'])) return undefined;
    const usage = payload['usage'];
    const promptTokens = usage['prompt_tokens'];
    const completionTokens = usage['completion_tokens'];
    if (!this.isTokenCount(promptTokens) || !this.isTokenCount(completionTokens)) return undefined;
    const details = usage['completion_tokens_details'];
    const reasoningTokens = this.isRecord(details) ? details['reasoning_tokens'] : undefined;
    return {
      promptTokens,
      completionTokens,
      ...(this.isTokenCount(reasoningTokens) ? { reasoningTokens } : {}),
    };
  }

  private isTokenCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  private getFinishReason(payload: unknown): unknown {
    if (!this.isRecord(payload) || !Array.isArray(payload['choices'])) return undefined;
    const choice: unknown = payload['choices'][0];
    return this.isRecord(choice) ? choice['finish_reason'] : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
