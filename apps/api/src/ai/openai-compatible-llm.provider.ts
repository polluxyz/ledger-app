import {
  type LLMProvider,
  type LlmProviderDescriptor,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider';

import { sendLlmHttpRequest } from './llm-http-transport';

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
    const { text: responseText, timings } = await sendLlmHttpRequest({
      url: this.options.url,
      getBearerToken: this.options.getBearerToken,
      timeoutMs: this.options.timeoutMs,
      fetchImplementation: this.options.fetchImplementation,
      body: {
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
        ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
      },
    });
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
