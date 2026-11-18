import type { LLMProvider, LlmProviderDescriptor, LlmRequest, LlmResponse } from './llm-provider';
import { createAnthropicOutputSchema } from './anthropic-output-schema';
import { sendLlmHttpRequest } from './llm-http-transport';

interface ProviderOptions {
  descriptor: LlmProviderDescriptor;
  url: string;
  getBearerToken: () => Promise<string>;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

/**
 * 透過 Vertex rawPredict 送 Anthropic 格式。只接受正常結束的單一文字區塊，
 * 拒答與未知結束原因只轉成固定標記，避免文字與分類跨過 provider 邊界。
 */
export class AnthropicVertexLlmProvider implements LLMProvider {
  readonly descriptor: LlmProviderDescriptor;

  constructor(private readonly options: ProviderOptions) {
    this.descriptor = options.descriptor;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const { text, timings } = await sendLlmHttpRequest({
      url: this.options.url,
      getBearerToken: this.options.getBearerToken,
      timeoutMs: this.options.timeoutMs,
      fetchImplementation: this.options.fetchImplementation,
      body: {
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        thinking: { type: 'disabled' },
        output_config: {
          format: {
            type: 'json_schema',
            schema: createAnthropicOutputSchema(request.schema, request.codes),
          },
        },
      },
    });
    const empty: LlmResponse = { content: null, truncated: false, timings };
    if (text === null) return empty;
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return empty;
    }
    if (!isRecord(payload)) return empty;
    const usage = getUsage(payload['usage']);
    const result: LlmResponse = { ...empty, ...(usage ? { usage } : {}) };
    switch (payload['stop_reason']) {
      case 'refusal':
        return { ...result, refused: true };
      case 'max_tokens':
      case 'model_context_window_exceeded':
        return { ...result, truncated: true };
      case 'end_turn':
        return { ...result, content: parseTextBlock(payload['content']) };
      default:
        return result;
    }
  }
}

/** 只忽略 thinking；其他種類與多段文字都不能拼成看似合法的草稿。 */
function parseTextBlock(content: unknown): unknown {
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content as unknown[]) {
    if (!isRecord(block)) return null;
    if (block['type'] === 'thinking') continue;
    if (block['type'] !== 'text' || typeof block['text'] !== 'string') return null;
    texts.push(block['text']);
  }
  if (texts.length !== 1) return null;
  try {
    return JSON.parse(texts[0]!) as unknown;
  } catch {
    return null;
  }
}

/** 欄位只要有一項不可信，整份用量就不明；快取欄位只有缺值才視為 0。 */
function getUsage(value: unknown): LlmResponse['usage'] {
  if (!isRecord(value)) return undefined;
  const input = value['input_tokens'];
  const output = value['output_tokens'];
  const creation = Object.hasOwn(value, 'cache_creation_input_tokens')
    ? value['cache_creation_input_tokens']
    : 0;
  const read = Object.hasOwn(value, 'cache_read_input_tokens')
    ? value['cache_read_input_tokens']
    : 0;
  if (
    !isTokenCount(input) ||
    !isTokenCount(output) ||
    !isTokenCount(creation) ||
    !isTokenCount(read)
  ) {
    return undefined;
  }
  const promptTokens = input + creation + read;
  if (!Number.isSafeInteger(promptTokens)) return undefined;
  return { promptTokens, completionTokens: output };
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
