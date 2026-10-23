import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@ledger/shared';
import type { Env } from '../config/env.validation';
import { AppException } from '../common/exceptions/app.exception';
import { FakeLlmProvider } from './fake-llm.provider';
import type { LLMProvider } from './llm-provider';

/** 設定不完整只影響 AI 請求，不能阻止其他記帳功能啟動。 */
export function createLlmProvider(config: ConfigService<Env, true>): LLMProvider {
  if (config.get('LLM_PROVIDER', { infer: true }) === 'fake') return new FakeLlmProvider();
  // T5 接上 GLM provider；完整與不完整的設定這次都維持未設定，不偷偷改用 fake。
  return {
    complete: () => {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.AI_NOT_CONFIGURED,
        'AI is not configured.',
      );
    },
  };
}
