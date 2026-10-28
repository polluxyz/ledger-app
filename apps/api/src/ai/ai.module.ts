import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiUserThrottleGuard } from './ai-user-throttle.guard';
import { unavailableTokenSource, VERTEX_TOKEN_SOURCE } from './access-token-source';
import { LLM_PROVIDER } from './llm-provider';
import { createLlmProvider } from './llm-provider.factory';
import { AiQuotaService } from './ai-quota.service';
import { AI_CLOCK, AI_QUOTA_LIMITS } from './ai-quota.tokens';
import type { Env } from '../config/env.validation';

/** provider 以 token 注入，測試與日後模型替換均不改解析流程。 */
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiQuotaService,
    UsersService,
    AiUserThrottleGuard,
    { provide: LLM_PROVIDER, inject: [ConfigService], useFactory: createLlmProvider },
    // T0 佔位：一律丟錯。T1 改成只在 LLM_PROVIDER=vertex 時建立真的認證來源。
    { provide: VERTEX_TOKEN_SOURCE, useValue: unavailableTokenSource },
    { provide: AI_CLOCK, useValue: () => new Date() },
    {
      provide: AI_QUOTA_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        perUserDaily: config.get('AI_PARSE_DAILY_LIMIT_PER_USER', { infer: true }) ?? 50,
        globalDaily: config.get('AI_DAILY_LIMIT_GLOBAL', { infer: true }) ?? 500,
        maxOutputTokens: config.get('AI_PARSE_MAX_OUTPUT_TOKENS', { infer: true }) ?? 2048,
      }),
    },
  ],
})
export class AiModule {}
