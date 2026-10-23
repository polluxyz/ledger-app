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
    expect(
      createLlmProvider(new ConfigService<Env, true>({ LLM_PROVIDER: 'fake' })),
    ).toBeInstanceOf(FakeLlmProvider);
  });

  it('selects GLM when key and model are both set', () => {
    expect(
      createLlmProvider(
        new ConfigService<Env, true>({
          LLM_PROVIDER: 'glm',
          GLM_API_KEY: ' key ',
          GLM_MODEL: 'model',
          GLM_BASE_URL: 'https://example.test/v4',
        }),
      ),
    ).toBeInstanceOf(GlmLlmProvider);
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
      ).complete({ system: '', user: '', schema: {} });
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
    await expect(async () =>
      provider.complete({ system: '', user: '', schema: {} }),
    ).rejects.toMatchObject({ status: 503, errorCode: 'AI_NOT_CONFIGURED' });
  });
});
