import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';
import { GlmLlmProvider } from './glm-llm.provider';
import { LlmProviderError } from './llm-provider';

const request = { system: 'system', user: 'user', schema: {}, maxOutputTokens: 3072 };
function response(reasoningTokens: unknown = 7): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"drafts":[]}' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        completion_tokens_details: { reasoning_tokens: reasoningTokens },
      },
    }),
  );
}
function setup(getBearerToken = jest.fn(() => Promise.resolve('token'))) {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(() => Promise.resolve(response()));
  const provider = new OpenAiCompatibleLlmProvider({
    descriptor: { configured: true, provider: 'vertex', model: 'test-model' },
    url: 'https://aiplatform.googleapis.com/fixed',
    model: 'test-model',
    timeoutMs: 60_000,
    getBearerToken,
    fetchImplementation: fetchMock,
  });
  return { provider, fetchMock, getBearerToken };
}

/** 以假時鐘與假 fetch 驗證共用期限、token 信任邊界及只送出一次的傳輸契約。 */
describe('OpenAiCompatibleLlmProvider', () => {
  beforeEach(() => jest.useFakeTimers({ now: 0 }));
  afterEach(() => jest.useRealTimers());

  it('SC-P35: uses the latest token, JSON mode and max_tokens without reasoning_effort', async () => {
    const { provider, getBearerToken, fetchMock } = setup();
    getBearerToken.mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    for (const token of ['first', 'second']) {
      const result = await provider.complete(request);
      expect(result.timings).toEqual({ tokenMs: 0, headersMs: 0, bodyMs: 0 });
      const init = fetchMock.mock.lastCall?.[1];
      expect(init).toMatchObject({
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
      });
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ max_tokens: 3072, response_format: { type: 'json_object' } });
      expect(body).not.toHaveProperty('reasoning_effort');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the approved GLM success shape while Vertex reports timings', async () => {
    const { provider, fetchMock } = setup();
    expect(await provider.complete(request)).toHaveProperty('timings');
    const glm = new GlmLlmProvider('key', 'glm', 'https://glm.test', undefined, fetchMock);
    expect(await glm.complete(request)).not.toHaveProperty('timings');
  });

  it.each([0, 7, -1, 0.5, '7', null, undefined, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'SC-P37: accepts only nonnegative safe integer reasoning tokens (%p)',
    async (value) => {
      const { provider, fetchMock } = setup();
      // undefined 也要真的省略，而非落到 helper 的預設參數。
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              completion_tokens_details: { reasoning_tokens: value },
            },
          }),
        ),
      );
      const result = await provider.complete(request);
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        ...(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? { reasoningTokens: value }
          : {}),
      });
    },
  );

  it('SC-P37.1: stops waiting for a token at 60s and never sends a late inference', async () => {
    let resolveToken!: (value: string) => void;
    const { provider, fetchMock } = setup(
      jest.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      ),
    );
    const result = expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'timeout',
      durationMs: 60_000,
    });
    await jest.advanceTimersByTimeAsync(60_000);
    await result;
    resolveToken('late');
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('SC-P37.2: token time is deducted from the inference budget', async () => {
    const { provider, fetchMock } = setup(
      jest.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('token'), 50_000))),
    );
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const result = expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'timeout',
      durationMs: 60_000,
      timings: { tokenMs: 50_000 },
    });
    await jest.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.lastCall?.[1]?.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await result;
    expect(fetchMock.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
  });

  it('SC-P37.3: returns at the deadline and consumes a late auth rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { provider, fetchMock } = setup(
        jest.fn(
          () =>
            new Promise<string>((_resolve, reject) =>
              setTimeout(() => reject(new Error('private-late-failure')), 90_000),
            ),
        ),
      );
      const result = expect(provider.complete(request)).rejects.toMatchObject({
        kind: 'timeout',
        durationMs: 60_000,
      });
      await jest.advanceTimersByTimeAsync(60_000);
      await result;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('SC-P37.4: accepts a response at 59s and records cumulative milestones', async () => {
    const { provider, fetchMock } = setup();
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(response()), 59_000)),
    );
    const result = provider.complete(request);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(await result).toMatchObject({
      content: { drafts: [] },
      timings: { tokenMs: 0, headersMs: 59_000, bodyMs: 59_000 },
    });
  });

  it('SC-P37: includes body reading in the deadline even if the body ignores abort', async () => {
    const { provider, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>()));
    const result = expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'timeout',
      timings: { tokenMs: 0, headersMs: 0 },
    });
    await jest.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it('SC-P37.5: discards even an unsafe LlmProviderError from the token source', async () => {
    const unsafe = new LlmProviderError('http', 401, 12);
    unsafe.message = 'secret-path secret-email secret-token';
    const { provider, fetchMock } = setup(jest.fn(() => Promise.reject(unsafe)));
    let error: unknown;
    try {
      await provider.complete(request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ kind: 'auth', timings: { tokenMs: 0 } });
    expect(error).not.toBe(unsafe);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 503])('does not retry inference HTTP %i', async (status) => {
    const { provider, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response('private', { status }));
    await expect(provider.complete(request)).rejects.toMatchObject({ kind: 'http', status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
