import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@ledger/shared';
import type { Env } from '../config/env.validation';
import { AppException } from '../common/exceptions/app.exception';
import { FakeLlmProvider } from './fake-llm.provider';
import { GlmLlmProvider } from './glm-llm.provider';
import type { LLMProvider } from './llm-provider';

/**
 * 依 `LLM_PROVIDER` 選模型。設定不完整只影響 AI 請求，不能阻止其他記帳功能啟動，
 * 也不能悄悄改用 fake——那會讓正式環境回出假草稿。
 */
export function createLlmProvider(config: ConfigService<Env, true>): LLMProvider {
  if (config.get('LLM_PROVIDER', { infer: true }) === 'fake') return new FakeLlmProvider();
  const apiKey = config.get('GLM_API_KEY', { infer: true })?.trim();
  const model = config.get('GLM_MODEL', { infer: true })?.trim();
  if (apiKey && model) {
    return new GlmLlmProvider(
      apiKey,
      model,
      config.get('GLM_BASE_URL', { infer: true }),
      config.get('GLM_REASONING_EFFORT', { infer: true }),
    );
  }
  return {
    // 讓 AiService 在扣額度前就擋下；complete 仍丟錯當保險。
    descriptor: { configured: false, provider: 'glm', model: null },
    complete: () => {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.AI_NOT_CONFIGURED,
        'AI is not configured.',
      );
    },
  };
}
