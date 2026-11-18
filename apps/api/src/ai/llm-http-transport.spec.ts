import { LlmProviderError } from './llm-provider';
import { sendLlmHttpRequest } from './llm-http-transport';

/** 用假 token、fetch 與時鐘驗證共用傳輸的安全邊界，不連外部服務。 */
describe('sendLlmHttpRequest', () => {
  const getBearerToken = jest.fn<Promise<string>, []>();
  const fetchImplementation = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const options = {
    url: 'https://example.invalid/inference',
    body: { messages: [] },
    getBearerToken,
    fetchImplementation,
    timeoutMs: 60_000,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    getBearerToken.mockReset().mockResolvedValue('test-token');
    fetchImplementation.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('SC-P47 sends authenticated POST with redirect rejection and cumulative timings', async () => {
    fetchImplementation.mockResolvedValue(new Response('response'));
    const result = await sendLlmHttpRequest(options);
    expect(result).toEqual({
      status: 200,
      text: 'response',
      timings: { tokenMs: 0, headersMs: 0, bodyMs: 0 },
    });
    expect(fetchImplementation).toHaveBeenCalledWith(options.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
      redirect: 'error',
      signal: expect.any(AbortSignal) as unknown,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('SC-P47 times out token acquisition before fetch', async () => {
    getBearerToken.mockReturnValue(new Promise(() => undefined));
    const pending = sendLlmHttpRequest(options);
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'timeout',
      durationMs: 60_000,
    });
    await jest.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('SC-P47 bounds an uncooperative response body by the same deadline', async () => {
    fetchImplementation.mockResolvedValue(new Response(new ReadableStream()));
    const pending = sendLlmHttpRequest(options);
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'timeout',
      durationMs: 60_000,
    });
    await jest.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('SC-P47 accepts exactly 64 KiB and rejects larger UTF-8 bodies', async () => {
    fetchImplementation.mockResolvedValueOnce(new Response('a'.repeat(64 * 1024)));
    expect((await sendLlmHttpRequest(options)).text).toHaveLength(64 * 1024);
    fetchImplementation.mockResolvedValueOnce(new Response('中'.repeat(22_000)));
    expect((await sendLlmHttpRequest(options)).text).toBeNull();
  });

  it('SC-P47 SC-P48 rejects HTTP 400 without reading its error body', async () => {
    const response = new Response('private-error', { status: 400 });
    const reader = jest.spyOn(response.body!, 'getReader');
    fetchImplementation.mockResolvedValue(response);
    await expect(sendLlmHttpRequest(options)).rejects.toMatchObject({ kind: 'http', status: 400 });
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('SC-P48 sanitizes empty token %p', async (token) => {
    getBearerToken.mockResolvedValue(token);
    await expect(sendLlmHttpRequest(options)).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each(['auth', 'network'] as const)(
    'SC-P48 discards original %s error and cause',
    async (kind) => {
      const secret = 'private-token-path-email';
      if (kind === 'auth') getBearerToken.mockRejectedValue(new Error(secret));
      else fetchImplementation.mockRejectedValue(new Error(secret));
      const error: unknown = await sendLlmHttpRequest(options).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toMatchObject({ kind });
      expect(String(error)).not.toContain(secret);
      expect(error).not.toHaveProperty('cause');
    },
  );
});
