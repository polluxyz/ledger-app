import { ConfigService } from '@nestjs/config';
import { createLlmProvider } from './llm-provider.factory';
import { FakeLlmProvider } from './fake-llm.provider';
import { GlmLlmProvider } from './glm-llm.provider';
import type { Env } from '../config/env.validation';
import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';

/**
 * factory 不能在設定缺漏時阻止啟動，也不能悄悄回退假模型。
 * 策略：直接餵 ConfigService 各種組合，看回傳的 provider 型別，
 * 不完整的設定實際呼叫一次，確認是 503 AI_NOT_CONFIGURED。
 */
describe('LLM provider factory', () => {
  it('selects fake explicitly', () => {
    const provider = createLlmProvider(new ConfigService<Env, true>({ LLM_PROVIDER: 'fake' }));

    expect(provider).toBeInstanceOf(FakeLlmProvider);
    expect(provider.descriptor).toEqual({ configured: true, provider: 'fake', model: null });
  });

  it('selects GLM when key and model are both set', () => {
    const provider = createLlmProvider(
      new ConfigService<Env, true>({
        LLM_PROVIDER: 'glm',
        GLM_API_KEY: ' key ',
        GLM_MODEL: 'model',
        GLM_BASE_URL: 'https://example.test/v4',
      }),
    );

    expect(provider).toBeInstanceOf(GlmLlmProvider);
    expect(provider.descriptor).toEqual({ configured: true, provider: 'glm', model: 'model' });
  });

  it('passes the configured reasoning effort to the GLM request', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"drafts":[]}' } }] })),
      );
    try {
      await createLlmProvider(
        new ConfigService<Env, true>({
          LLM_PROVIDER: 'glm',
          GLM_API_KEY: 'key',
          GLM_MODEL: 'model',
          GLM_BASE_URL: 'https://example.test/v4',
          GLM_REASONING_EFFORT: 'low',
        }),
      ).complete({ system: '', user: '', schema: {}, maxOutputTokens: 2048 });
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
        string,
        unknown
      >;
      expect(body['reasoning_effort']).toBe('low');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it.each([
    {},
    { GLM_API_KEY: '  ' },
    { GLM_API_KEY: 'key' },
    { GLM_MODEL: 'model' },
    { GLM_API_KEY: '  ', GLM_MODEL: 'model' },
    { GLM_API_KEY: 'key', GLM_MODEL: '  ' },
  ])('reports AI_NOT_CONFIGURED for incomplete GLM config %p', async (values) => {
    const provider = createLlmProvider(
      new ConfigService<Env, true>({ LLM_PROVIDER: 'glm', ...values }),
    );
    expect(provider).not.toBeInstanceOf(FakeLlmProvider);
    expect(provider).not.toBeInstanceOf(GlmLlmProvider);
    expect(provider.descriptor).toEqual({ configured: false, provider: 'glm', model: null });
    await expect(async () =>
      provider.complete({ system: '', user: '', schema: {}, maxOutputTokens: 2048 }),
    ).rejects.toMatchObject({ status: 503, errorCode: 'AI_NOT_CONFIGURED' });
  });

  it.each(['global', 'us-central1'])(
    'SC-P34 / SC-P35: builds the fixed Vertex URL for %s and uses the latest token',
    async (location) => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ choices: [{ message: { content: '{"drafts":[]}' } }] })),
          ),
        );
      const tokenSource = {
        getAccessToken: jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second'),
      };
      try {
        const provider = createLlmProvider(
          new ConfigService<Env, true>({
            LLM_PROVIDER: 'vertex',
            VERTEX_PROJECT_ID: 'test-project',
            VERTEX_MODEL: 'deepseek-test',
            VERTEX_LOCATION: location,
          }),
          tokenSource,
        );
        expect(provider).toBeInstanceOf(OpenAiCompatibleLlmProvider);
        expect(provider.descriptor).toEqual({
          configured: true,
          provider: 'vertex',
          model: 'deepseek-test',
        });
        for (const token of ['first', 'second']) {
          await provider.complete({ system: '', user: '', schema: {}, maxOutputTokens: 4096 });
          const host =
            location === 'global'
              ? 'aiplatform.googleapis.com'
              : 'us-central1-aiplatform.googleapis.com';
          expect(fetchMock).toHaveBeenLastCalledWith(
            `https://${host}/v1/projects/test-project/locations/${location}/endpoints/openapi/chat/completions`,
            expect.objectContaining({
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              redirect: 'error',
            }),
          );
          const body = JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string) as Record<
            string,
            unknown
          >;
          expect(body).toMatchObject({
            max_tokens: 4096,
            response_format: { type: 'json_object' },
          });
          expect(body).not.toHaveProperty('reasoning_effort');
        }
      } finally {
        fetchMock.mockRestore();
      }
    },
  );

  it.each([
    {},
    { VERTEX_PROJECT_ID: 'test-project' },
    { VERTEX_MODEL: 'model' },
    { VERTEX_PROJECT_ID: '  ', VERTEX_MODEL: 'model' },
    { VERTEX_PROJECT_ID: 'test-project', VERTEX_MODEL: '  ' },
  ])('SC-P34: keeps incomplete Vertex configuration isolated (%p)', async (values) => {
    const tokenSource = { getAccessToken: jest.fn() };
    const provider = createLlmProvider(
      new ConfigService<Env, true>({ LLM_PROVIDER: 'vertex', ...values }),
      tokenSource,
    );
    expect(provider.descriptor).toEqual({ configured: false, provider: 'vertex', model: null });
    await expect(async () =>
      provider.complete({ system: '', user: '', schema: {}, maxOutputTokens: 2048 }),
    ).rejects.toMatchObject({ status: 503, errorCode: 'AI_NOT_CONFIGURED' });
    expect(tokenSource.getAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['vertex', 60_000],
    ['glm', 25_000],
  ] as const)('SC-P34.4: %s has a %i ms deadline', async (selected, timeoutMs) => {
    jest.useFakeTimers({ now: 0 });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}));
    try {
      const provider = createLlmProvider(
        new ConfigService<Env, true>({
          LLM_PROVIDER: selected,
          VERTEX_PROJECT_ID: 'test-project',
          VERTEX_MODEL: 'model',
          VERTEX_LOCATION: 'global',
          GLM_API_KEY: 'key',
          GLM_MODEL: 'model',
          GLM_BASE_URL: 'https://glm.test',
        }),
        { getAccessToken: () => Promise.resolve('token') },
      );
      let settled = false;
      const operation = provider.complete({
        system: '',
        user: '',
        schema: {},
        maxOutputTokens: 2048,
      });
      void operation.catch(() => {
        settled = true;
      });
      const assertion = expect(operation).rejects.toMatchObject({
        kind: 'timeout',
        durationMs: timeoutMs,
      });
      await jest.advanceTimersByTimeAsync(timeoutMs - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
    } finally {
      fetchMock.mockRestore();
      jest.useRealTimers();
    }
  });
});
