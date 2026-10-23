import {
  LlmProviderError,
  type LLMProvider,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider';

// glm-5.3 即使思考強度 low 也偶有 10～20 秒的長尾；25 秒沒回就放棄，不自動重試（spec 決策 248）。
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * 以 OpenAI 相容的 chat completions API 呼叫 GLM，並把模型輸出保持在不可信 JSON 邊界內。
 * API key 只放在 Authorization 標頭；錯誤只回傳分類、狀態碼與耗時，避免洩漏句子或模型內容。
 */
export class GlmLlmProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly reasoningEffort?: 'low' | 'high' | 'max',
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: `${request.system}\n\nJSON schema:\n${JSON.stringify(request.schema)}`,
              },
              { role: 'user', content: request.user },
            ],
            stream: false,
            response_format: { type: 'json_object' },
            // 沒設定就不送，避免不認得這個欄位的模型回參數錯誤。
            ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
          }),
          redirect: 'error',
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new LlmProviderError('http', response.status, Date.now() - startedAt);
      }

      const responseText = await this.readResponseBody(response, controller);
      if (responseText === null) {
        return { content: null };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        // 解析錯誤訊息可能包含模型回應片段，因此只把它視為看不懂。
        return { content: null };
      }

      const messageContent = this.getMessageContent(payload);
      if (typeof messageContent !== 'string') {
        return { content: null };
      }

      let content: unknown;
      try {
        content = JSON.parse(messageContent) as unknown;
      } catch {
        // 不把 JSON.parse 的例外帶出這層，避免錯誤訊息攜帶模型內容。
        return { content: null };
      }

      const usage = this.getUsage(payload);
      return usage ? { content, usage } : { content };
    } catch (error: unknown) {
      if (error instanceof LlmProviderError) {
        throw error;
      }

      const kind = timedOut ? 'timeout' : 'network';
      throw new LlmProviderError(kind, null, Date.now() - startedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 逐塊累計 byte 數，避免超大回應先被完整讀進記憶體。 */
  private async readResponseBody(
    response: Response,
    controller: AbortController,
  ): Promise<string | null> {
    if (!response.body) {
      return '';
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

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
    if (!this.isRecord(payload) || !Array.isArray(payload['choices'])) {
      return null;
    }

    const firstChoice: unknown = payload['choices'][0];
    if (!this.isRecord(firstChoice) || !this.isRecord(firstChoice['message'])) {
      return null;
    }

    return firstChoice['message']['content'];
  }

  private getUsage(payload: unknown): LlmResponse['usage'] {
    if (!this.isRecord(payload) || !this.isRecord(payload['usage'])) {
      return undefined;
    }

    const promptTokens: unknown = payload['usage']['prompt_tokens'];
    const completionTokens: unknown = payload['usage']['completion_tokens'];
    if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') {
      return undefined;
    }

    return { promptTokens, completionTokens };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
