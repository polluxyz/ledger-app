import type { LLMProvider, LlmRequest, LlmResponse } from './llm-provider';
import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';

/** GLM 只組固定金鑰與網址；HTTP 防線共用，成功回應保留原有形狀以維持回歸契約。 */
export class GlmLlmProvider implements LLMProvider {
  private readonly provider: OpenAiCompatibleLlmProvider;
  readonly descriptor;

  constructor(
    apiKey: string,
    model: string,
    baseUrl: string,
    reasoningEffort?: 'low' | 'high' | 'max',
    fetchImplementation: typeof fetch = fetch,
    timeoutMs = 25_000,
  ) {
    this.provider = new OpenAiCompatibleLlmProvider({
      descriptor: { configured: true, provider: 'glm', model },
      url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      model,
      getBearerToken: () => Promise.resolve(apiKey),
      timeoutMs,
      reasoningEffort,
      fetchImplementation,
    });
    this.descriptor = this.provider.descriptor;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.provider.complete(request);
    return {
      content: response.content,
      truncated: response.truncated,
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }
}
