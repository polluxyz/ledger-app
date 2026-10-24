import { GlmLlmProvider } from './glm-llm.provider';
import { LlmProviderError } from './llm-provider';

const API_KEY = 'test-glm-secret-key';
const USER_SENTENCE = '昨天買咖啡 85';
const MODEL_RESPONSE = '{"drafts":[]}';
type FetchMockArguments = [input: RequestInfo | URL, init?: RequestInit];
type FetchMock = jest.Mock<Promise<Response>, FetchMockArguments>;
const BASE_REQUEST = {
  system: '請把句子轉成交易草稿。',
  user: USER_SENTENCE,
  schema: { type: 'object', required: ['drafts'] },
  maxOutputTokens: 2048,
};

function createFetchMock(response: Response): FetchMock {
  return jest.fn<Promise<Response>, FetchMockArguments>().mockResolvedValue(response);
}

function createCompletionResponse(
  content: unknown,
  options: { status?: number; usage?: unknown; choices?: unknown[] } = {},
): Response {
  const envelope = {
    choices: options.choices ?? [{ message: { content } }],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
  return new Response(JSON.stringify(envelope), { status: options.status ?? 200 });
}

function createProvider(
  fetchImplementation: FetchMock,
  baseUrl = 'https://open.bigmodel.cn/api/paas/v4',
  timeoutMs = 15,
  reasoningEffort?: 'low' | 'high' | 'max',
): GlmLlmProvider {
  return new GlmLlmProvider(
    API_KEY,
    'glm-test-model',
    baseUrl,
    reasoningEffort,
    fetchImplementation,
    timeoutMs,
  );
}

async function expectSafeProviderError(
  operation: Promise<unknown>,
  kind: LlmProviderError['kind'],
  status: number | null,
): Promise<LlmProviderError> {
  let caught: unknown;
  try {
    await operation;
  } catch (error: unknown) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(LlmProviderError);
  const error = caught as LlmProviderError;
  expect(error.kind).toBe(kind);
  expect(error.status).toBe(status);
  for (const serialized of [error.message, String(error), JSON.stringify(error)]) {
    expect(serialized).not.toContain(USER_SENTENCE);
    expect(serialized).not.toContain(MODEL_RESPONSE);
    expect(serialized).not.toContain(API_KEY);
  }
  expect(error.cause).toBeUndefined();
  expect(Object.hasOwn(error, 'cause')).toBe(false);
  return error;
}

/**
 * 驗證 GLM provider 的 HTTP 契約、錯誤隔離與不可信回應處理；所有網路互動都以 mock fetch 控制。
 */
describe('GlmLlmProvider', () => {
  describe('request format', () => {
    it.each([
      [
        'without trailing slash',
        'https://glm.example/api/paas/v4',
        'https://glm.example/api/paas/v4/chat/completions',
      ],
      [
        'with trailing slashes',
        'https://glm.example/api/paas/v4///',
        'https://glm.example/api/paas/v4/chat/completions',
      ],
    ])('keeps the base path when building the URL %s', async (_label, baseUrl, expectedUrl) => {
      const fetchMock = createFetchMock(createCompletionResponse('{"drafts":[]}'));

      await createProvider(fetchMock, baseUrl).complete(BASE_REQUEST);

      expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    });

    it('sends the OpenAI-compatible body and keeps the API key only in Authorization', async () => {
      const fetchMock = createFetchMock(createCompletionResponse('{"drafts":[]}'));

      await createProvider(fetchMock).complete(BASE_REQUEST);

      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          redirect: 'error',
        }),
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);

      expect(typeof init?.body).toBe('string');
      const requestBody = init?.body as string;
      const body = JSON.parse(requestBody) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream: boolean;
        response_format: { type: string };
      };
      expect(body).toEqual({
        model: 'glm-test-model',
        messages: [
          {
            role: 'system',
            content: `${BASE_REQUEST.system}\n\nJSON schema:\n${JSON.stringify(BASE_REQUEST.schema)}`,
          },
          { role: 'user', content: USER_SENTENCE },
        ],
        stream: false,
        response_format: { type: 'json_object' },
      });
      expect(url).not.toContain(API_KEY);
      expect(requestBody).not.toContain(API_KEY);
      expect(JSON.stringify({ ...init, headers: {} })).not.toContain(API_KEY);
    });

    it('adds reasoning_effort only when it is configured', async () => {
      const fetchMock = createFetchMock(createCompletionResponse('{"drafts":[]}'));

      await createProvider(fetchMock, undefined, 15, 'low').complete(BASE_REQUEST);

      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
        string,
        unknown
      >;
      expect(body['reasoning_effort']).toBe('low');
    });
  });

  describe('timeouts and provider errors', () => {
    it('classifies a timeout while waiting for response headers', async () => {
      const fetchMock = jest.fn<Promise<Response>, FetchMockArguments>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`)),
              { once: true },
            );
          }),
      );

      const error = await expectSafeProviderError(
        createProvider(fetchMock, undefined, 10).complete(BASE_REQUEST),
        'timeout',
        null,
      );

      expect(error.durationMs).toBeGreaterThanOrEqual(0);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it('classifies a timeout after headers arrive while the response body is still being read', async () => {
      let requestSignal: AbortSignal | undefined;
      const fetchMock = jest.fn<Promise<Response>, FetchMockArguments>((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            requestSignal?.addEventListener(
              'abort',
              () => controller.error(new Error(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`)),
              { once: true },
            );
          },
        });
        return Promise.resolve(new Response(body));
      });

      await expectSafeProviderError(
        createProvider(fetchMock, undefined, 10).complete(BASE_REQUEST),
        'timeout',
        null,
      );

      expect(requestSignal?.aborted).toBe(true);
    });

    it.each([400, 503])('classifies HTTP %i without exposing its response body', async (status) => {
      const fetchMock = createFetchMock(
        new Response(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`, { status }),
      );

      await expectSafeProviderError(
        createProvider(fetchMock).complete(BASE_REQUEST),
        'http',
        status,
      );
    });

    it('classifies network failures without carrying the original error as cause', async () => {
      const fetchMock = jest
        .fn<Promise<Response>, FetchMockArguments>()
        .mockRejectedValue(new Error(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`));

      await expectSafeProviderError(
        createProvider(fetchMock).complete(BASE_REQUEST),
        'network',
        null,
      );
    });

    it('rejects redirects and classifies the fetch failure as network', async () => {
      const fetchMock = jest
        .fn<Promise<Response>, FetchMockArguments>()
        .mockRejectedValue(new TypeError(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`));

      await expectSafeProviderError(
        createProvider(fetchMock).complete(BASE_REQUEST),
        'network',
        null,
      );
      expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
    });

    it('classifies response body read failures as network errors', async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error(`${USER_SENTENCE} ${MODEL_RESPONSE} ${API_KEY}`));
        },
      });
      const fetchMock = jest
        .fn<Promise<Response>, FetchMockArguments>()
        .mockResolvedValue(new Response(body));

      await expectSafeProviderError(
        createProvider(fetchMock).complete(BASE_REQUEST),
        'network',
        null,
      );
    });
  });

  describe('response parsing', () => {
    it.each([
      ['empty choices', createCompletionResponse('', { choices: [] })],
      ['null content', createCompletionResponse(null)],
      ['non-string content', createCompletionResponse({ not: 'a string' })],
      ['invalid JSON content', createCompletionResponse('this is not JSON')],
      ['truncated JSON content', createCompletionResponse('{"drafts":')],
    ])('returns null content for %s', async (_label, response) => {
      const fetchMock = createFetchMock(response);

      await expect(createProvider(fetchMock).complete(BASE_REQUEST)).resolves.toEqual({
        truncated: false,
        content: null,
      });
    });

    it('returns null content and aborts when the response body exceeds the size limit', async () => {
      let requestSignal: AbortSignal | undefined;
      const oversizedResponse = JSON.stringify({
        choices: [{ message: { content: 'x'.repeat(70 * 1024) } }],
      });
      const fetchMock = jest.fn<Promise<Response>, FetchMockArguments>((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response(oversizedResponse));
      });

      await expect(createProvider(fetchMock).complete(BASE_REQUEST)).resolves.toEqual({
        truncated: false,
        content: null,
      });
      expect(requestSignal?.aborted).toBe(true);
    });

    it('returns usage when both token counts are numbers', async () => {
      const fetchMock = createFetchMock(
        createCompletionResponse('{"drafts":[]}', {
          usage: { prompt_tokens: 23, completion_tokens: 11 },
        }),
      );

      await expect(createProvider(fetchMock).complete(BASE_REQUEST)).resolves.toEqual({
        truncated: false,
        content: { drafts: [] },
        usage: { promptTokens: 23, completionTokens: 11 },
      });
    });

    it('omits usage when token counts are missing or not numbers', async () => {
      const fetchMock = createFetchMock(
        createCompletionResponse('{"drafts":[]}', {
          usage: { prompt_tokens: 23, completion_tokens: '11' },
        }),
      );

      await expect(createProvider(fetchMock).complete(BASE_REQUEST)).resolves.toEqual({
        truncated: false,
        content: { drafts: [] },
      });
    });

    it('ignores reasoning_content and only parses choices[0].message.content', async () => {
      const fetchMock = createFetchMock(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"drafts":[]}', reasoning_content: MODEL_RESPONSE } }],
          }),
        ),
      );

      await expect(createProvider(fetchMock).complete(BASE_REQUEST)).resolves.toEqual({
        truncated: false,
        content: { drafts: [] },
      });
    });
  });
});
