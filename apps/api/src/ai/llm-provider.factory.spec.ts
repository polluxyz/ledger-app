import { ConfigService } from '@nestjs/config';
import { createLlmProvider } from './llm-provider.factory';
import { FakeLlmProvider } from './fake-llm.provider';
import { GlmLlmProvider } from './glm-llm.provider';
import type { Env } from '../config/env.validation';

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
});
