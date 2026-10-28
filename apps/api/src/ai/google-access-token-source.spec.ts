import { generateKeyPairSync } from 'node:crypto';
import { GoogleAuth, type GoogleAuthOptions } from 'google-auth-library';
import { GoogleAccessTokenSource } from './google-access-token-source';
import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';

/** 真實 GoogleAuth 與動態假金鑰，僅替換底層 fetch；不讀實際 ADC、不連 Google。 */
describe('GoogleAccessTokenSource', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const credentials = {
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'fake@example.invalid',
    private_key: privateKey,
  };
  let fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
  let auth: GoogleAuth;
  let suppliedOptions: GoogleAuthOptions;

  function source(keyFilename?: string) {
    return new GoogleAccessTokenSource(keyFilename, (options) => {
      suppliedOptions = options;
      const clientOptions = options.clientOptions;
      const transporterOptions =
        clientOptions && 'transporterOptions' in clientOptions
          ? clientOptions.transporterOptions
          : undefined;
      // 假憑證直接在記憶體中提供；正式的 scope、重試與日誌設定全部沿用。
      auth = new GoogleAuth({
        ...options,
        keyFilename: undefined,
        credentials,
        projectId: 'test-project',
        clientOptions: {
          ...options.clientOptions,
          transporterOptions: {
            ...transporterOptions,
            fetchImplementation: fetchMock,
          },
        },
      });
      return auth;
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2040-01-01T00:00:00Z') });
    fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: `token-${fetchMock.mock.calls.length}`,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('SC-P34.3: explicitly passes keyFilename only when configured and disables auth interceptors', async () => {
    const explicit = source('/outside/fake-key.json');
    expect(suppliedOptions).toMatchObject({
      keyFilename: '/outside/fake-key.json',
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    await explicit.getAccessToken();
    const client = await auth.getClient();
    expect(client.transporter.interceptors.request.size).toBe(0);
    expect(client.transporter.interceptors.response.size).toBe(0);
    source();
    expect(suppliedOptions).not.toHaveProperty('keyFilename');
  });

  it('SC-P36.1: reuses a token for three consecutive requests', async () => {
    const tokens = source();
    for (let index = 0; index < 3; index++) expect(await tokens.getAccessToken()).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('SC-P36.2: refreshes before expiry', async () => {
    const tokens = source();
    expect(await tokens.getAccessToken()).toBe('token-1');
    await jest.advanceTimersByTimeAsync(56 * 60 * 1000);
    expect(await tokens.getAccessToken()).toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('SC-P36.3: five concurrent requests share one refresh', async () => {
    const tokens = source();
    await tokens.getAccessToken();
    await jest.advanceTimersByTimeAsync(56 * 60 * 1000);
    expect(await Promise.all(Array.from({ length: 5 }, () => tokens.getAccessToken()))).toEqual(
      Array(5).fill('token-2'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('SC-P36.4: a failed refresh is auth, does not retry, and the next call recovers', async () => {
    const tokens = source();
    await tokens.getAccessToken();
    await jest.advanceTimersByTimeAsync(56 * 60 * 1000);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'temporary_failure', error_description: 'private-details' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const inference = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const provider = new OpenAiCompatibleLlmProvider({
      descriptor: { configured: true, provider: 'vertex', model: 'test' },
      url: 'https://aiplatform.googleapis.com/fixed',
      model: 'test',
      timeoutMs: 60_000,
      getBearerToken: () => tokens.getAccessToken(),
      fetchImplementation: inference,
    });
    await expect(
      provider.complete({ system: '', user: '', schema: {}, maxOutputTokens: 2048 }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(inference).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await tokens.getAccessToken()).toBe('token-3');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects missing and blank tokens', async () => {
    for (const token of [null, '', '  ']) {
      const tokens = source();
      jest.spyOn(auth, 'getAccessToken').mockResolvedValue(token);
      await expect(tokens.getAccessToken()).rejects.toThrow('Access token unavailable');
    }
  });

  it('shares only in-flight work even when the underlying auth client does not coalesce', async () => {
    const tokens = source();
    let resolve!: (token: string) => void;
    const getToken = jest.spyOn(auth, 'getAccessToken').mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const calls = Array.from({ length: 5 }, () => tokens.getAccessToken());
    expect(getToken).toHaveBeenCalledTimes(1);
    resolve('shared');
    expect(await Promise.all(calls)).toEqual(Array(5).fill('shared'));
    getToken.mockResolvedValue('next');
    expect(await tokens.getAccessToken()).toBe('next');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('clears a failed in-flight operation so the next call can recover', async () => {
    const tokens = source();
    const getToken = jest
      .spyOn(auth, 'getAccessToken')
      .mockRejectedValueOnce(new Error('private-failure'))
      .mockResolvedValue('recovered');
    await expect(tokens.getAccessToken()).rejects.toThrow('private-failure');
    expect(await tokens.getAccessToken()).toBe('recovered');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('starts new auth work at 60s if a previous operation never returns', async () => {
    const tokens = source();
    const getToken = jest
      .spyOn(auth, 'getAccessToken')
      .mockImplementationOnce(() => new Promise<string>(() => {}))
      .mockResolvedValue('recovered');
    const first = tokens.getAccessToken();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(tokens.getAccessToken()).toBe(first);
    await jest.advanceTimersByTimeAsync(1);
    expect(await tokens.getAccessToken()).toBe('recovered');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('does not let stale work clear a newer in-flight operation', async () => {
    const tokens = source();
    let resolveOld!: (token: string) => void;
    let resolveNew!: (token: string) => void;
    const getToken = jest
      .spyOn(auth, 'getAccessToken')
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolveOld = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolveNew = done;
          }),
      );
    const first = tokens.getAccessToken();
    await jest.advanceTimersByTimeAsync(60_000);
    const second = tokens.getAccessToken();
    resolveOld('old');
    await first;
    expect(tokens.getAccessToken()).toBe(second);
    resolveNew('new');
    expect(await second).toBe('new');
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
