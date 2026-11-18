import { AnthropicVertexLlmProvider } from './anthropic-vertex-llm.provider';
import { AI_WIRE_JSON_SCHEMA } from './ai-wire-format';
import { createAnthropicOutputSchema } from './anthropic-output-schema';
import type { LlmRequest } from './llm-provider';

/** mock fetch 與 token 來源驗證 Anthropic 格式、用量與安全邊界，不呼叫 Google。 */
describe('AnthropicVertexLlmProvider', () => {
  const url =
    'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/anthropic/models/claude-haiku-5-5:rawPredict';
  const request: LlmRequest = {
    system: '指示與清單',
    user: '早餐 60',
    schema: AI_WIRE_JSON_SCHEMA,
    maxOutputTokens: 2048,
    codes: { ledgers: ['L1'], categories: ['C1'], accounts: ['A1'] },
  };
  const usage = {
    input_tokens: 100,
    cache_creation_input_tokens: 15,
    cache_read_input_tokens: 5,
    output_tokens: 30,
  };
  const getBearerToken = jest.fn<Promise<string>, []>();
  const fetchImplementation = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const provider = new AnthropicVertexLlmProvider({
    descriptor: { configured: true, provider: 'vertex-anthropic', model: 'claude-haiku-5-5' },
    url,
    getBearerToken,
    fetchImplementation,
    timeoutMs: 60_000,
  });
  const textBlock = { type: 'text', text: '{"drafts":[]}' };
  function respond(overrides: Record<string, unknown> = {}) {
    fetchImplementation.mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [textBlock],
          usage,
          ...overrides,
        }),
      ),
    );
  }
  beforeEach(() => {
    getBearerToken.mockReset().mockResolvedValue('test-token');
    fetchImplementation.mockReset();
    respond();
  });
  afterEach(() => jest.useRealTimers());

  it('SC-P43.2 SC-P43.3 SC-P43.4 sends only approved fields and the current bearer token', async () => {
    getBearerToken.mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    for (const token of ['first', 'second']) {
      respond();
      await provider.complete(request);
      const [target, init] = fetchImplementation.mock.lastCall!;
      expect(target).toBe(url);
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init!.body as string) as unknown).toEqual({
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: 2048,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        thinking: { type: 'disabled' },
        output_config: {
          format: {
            type: 'json_schema',
            schema: createAnthropicOutputSchema(request.schema, request.codes),
          },
        },
      });
    }
    expect(getBearerToken).toHaveBeenCalledTimes(2);
  });

  it('SC-P44.1 parses end_turn with exactly one text block', async () => {
    await expect(provider.complete(request)).resolves.toMatchObject({
      content: { drafts: [] },
      truncated: false,
      usage: { promptTokens: 120, completionTokens: 30 },
    });
  });

  it('SC-P44.2 skips thinking blocks before and after the single text block', async () => {
    respond({
      content: [{ type: 'thinking', thinking: 'hidden' }, textBlock, { type: 'thinking' }],
    });
    expect((await provider.complete(request)).content).toEqual({ drafts: [] });
  });

  it.each([
    [],
    [textBlock, textBlock],
    [{ type: 'thinking' }],
    [textBlock, { type: 'tool_use' }],
    [textBlock, { type: 'unknown' }],
    [textBlock, null],
    [{ type: 'text', text: 123 }],
    null,
    {},
    'not blocks',
  ])('SC-P44.3 rejects ambiguous or unsupported content %p', async (content) => {
    respond({ content });
    const result = await provider.complete(request);
    expect(result.content).toBeNull();
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
  });

  it.each(['max_tokens', 'model_context_window_exceeded'])(
    'SC-P44.4 discards complete JSON for %s while retaining usage',
    async (stopReason) => {
      respond({ stop_reason: stopReason });
      const result = await provider.complete(request);
      expect(result).toMatchObject({
        content: null,
        truncated: true,
        usage: { promptTokens: 120, completionTokens: 30 },
      });
      expect(result).not.toHaveProperty('refused');
    },
  );

  it.each(['PRIVATE_UNKNOWN_STOP', undefined, null, 1, 'stop_sequence', 'tool_use', 'pause_turn'])(
    'SC-P44.5 suppresses unknown or missing stop_reason %p',
    async (stopReason) => {
      respond({ stop_reason: stopReason });
      const result = await provider.complete(request);
      expect(result).toMatchObject({
        content: null,
        truncated: false,
        usage: { promptTokens: 120, completionTokens: 30 },
      });
      expect(result).not.toHaveProperty('refused');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_UNKNOWN_STOP');
      expect(result).not.toHaveProperty('stop_reason');
    },
  );

  it.each(['not JSON', '```json\n{"drafts":[]}\n```'])(
    'SC-P44.6 rejects invalid JSON and unapproved fence repair (%s)',
    async (text) => {
      respond({ content: [{ type: 'text', text }] });
      expect(await provider.complete(request)).toMatchObject({
        content: null,
        usage: { promptTokens: 120, completionTokens: 30 },
      });
    },
  );

  it.each(['bad JSON', 'null', '[]'])(
    'SC-P44 rejects invalid outer message %s without inventing usage',
    async (text) => {
      fetchImplementation.mockResolvedValue(new Response(text));
      const result = await provider.complete(request);
      expect(result.content).toBeNull();
      expect(result.usage).toBeUndefined();
    },
  );

  it('SC-P45 SC-P48 returns only the refusal flag and numeric usage', async () => {
    respond({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'PRIVATE_REFUSAL' }],
      stop_details: { category: 'PRIVATE_CATEGORY', explanation: 'PRIVATE_REFUSAL' },
    });
    const result = await provider.complete(request);
    expect(result).toEqual({
      content: null,
      truncated: false,
      refused: true,
      usage: { promptTokens: 120, completionTokens: 30 },
      timings: expect.any(Object) as unknown,
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_REFUSAL|PRIVATE_CATEGORY/);
  });

  it('SC-P46.1 SC-P46.5 sums all input counts and omits reasoning tokens', async () => {
    const result = await provider.complete(request);
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
    expect(result.usage).not.toHaveProperty('reasoningTokens');
  });

  it.each([
    { input_tokens: 10, output_tokens: 0 },
    { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0 },
    { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0 },
  ])('SC-P46.2 counts only absent cache fields as zero (%p)', async (usage) => {
    respond({ usage });
    expect((await provider.complete(request)).usage).toEqual({
      promptTokens: 10,
      completionTokens: 0,
    });
  });

  it.each([
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ])('SC-P46.3 rejects invalid %s counts including present null', async (field) => {
    for (const invalid of [-1, 0.5, '12', null, Number.MAX_SAFE_INTEGER + 1]) {
      respond({ usage: { ...usage, [field]: invalid } });
      const result = await provider.complete(request);
      expect(result.usage).toBeUndefined();
      expect(result.content).toEqual({ drafts: [] });
    }
  });

  it.each([undefined, null, {}, { input_tokens: 1 }, { output_tokens: 1 }])(
    'SC-P46.3 rejects missing required usage fields (%p)',
    async (usage) => {
      respond({ usage });
      expect((await provider.complete(request)).usage).toBeUndefined();
    },
  );

  it('SC-P46.4 rejects an unsafe sum while accepting the exact safe boundary', async () => {
    respond({
      usage: {
        input_tokens: Number.MAX_SAFE_INTEGER,
        cache_read_input_tokens: 1,
        output_tokens: 1,
      },
    });
    expect((await provider.complete(request)).usage).toBeUndefined();
    respond({
      usage: {
        input_tokens: Number.MAX_SAFE_INTEGER - 1,
        cache_read_input_tokens: 1,
        output_tokens: 0,
      },
    });
    expect((await provider.complete(request)).usage).toEqual({
      promptTokens: Number.MAX_SAFE_INTEGER,
      completionTokens: 0,
    });
  });

  it('SC-P47.2 bounds token acquisition by 60 seconds without calling fetch', async () => {
    jest.useFakeTimers();
    getBearerToken.mockReturnValue(new Promise(() => undefined));
    const operation = provider.complete(request);
    const assertion = expect(operation).rejects.toMatchObject({
      kind: 'timeout',
      durationMs: 60_000,
    });
    await jest.advanceTimersByTimeAsync(59_999);
    expect(fetchImplementation).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('SC-P47.3 does not parse content or usage over 64 KiB', async () => {
    respond({ padding: 'x'.repeat(64 * 1024) });
    const result = await provider.complete(request);
    expect(result.content).toBeNull();
    expect(result.usage).toBeUndefined();
  });

  it('SC-P47.4 SC-P48 sanitizes HTTP 400 without reading, retrying or downgrading', async () => {
    const response = new Response('PRIVATE_ERROR_BODY', { status: 400 });
    const getReader = jest.spyOn(response.body!, 'getReader');
    fetchImplementation.mockResolvedValue(response);
    const error: unknown = await provider.complete(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'http', status: 400 });
    expect(String(error)).not.toContain('PRIVATE_ERROR_BODY');
    expect(getReader).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(getBearerToken).toHaveBeenCalledTimes(1);
  });

  it('SC-P48 discards token acquisition error details without calling fetch', async () => {
    getBearerToken.mockRejectedValue(new Error('PRIVATE_TOKEN'));
    const error: unknown = await provider.complete(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'auth' });
    expect(String(error)).not.toContain('PRIVATE_TOKEN');
    expect(error).not.toHaveProperty('cause');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
