import { ConfigService } from '@nestjs/config';
import { createLlmProvider } from './llm-provider.factory';
import { FakeLlmProvider } from './fake-llm.provider';
import type { Env } from '../config/env.validation';

/** factory 不能在設定缺漏時阻止啟動，也不能悄悄回退假模型。 */
describe('LLM provider factory', () => {
  it('selects fake explicitly', () => {
    expect(
      createLlmProvider(new ConfigService<Env, true>({ LLM_PROVIDER: 'fake' })),
    ).toBeInstanceOf(FakeLlmProvider);
  });
  it.each([
    {},
    { GLM_API_KEY: '  ' },
    { GLM_API_KEY: 'key' },
    { GLM_MODEL: 'model' },
    { GLM_API_KEY: 'key', GLM_MODEL: 'model' },
  ])('keeps GLM unavailable until T5 with config %p', async (values) => {
    const provider = createLlmProvider(
      new ConfigService<Env, true>({ LLM_PROVIDER: 'glm', ...values }),
    );
    await expect(async () =>
      provider.complete({ system: '', user: '', schema: {} }),
    ).rejects.toMatchObject({ status: 503, errorCode: 'AI_NOT_CONFIGURED' });
  });
});
