import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiUserThrottleGuard } from './ai-user-throttle.guard';
import { LLM_PROVIDER } from './llm-provider';
import { createLlmProvider } from './llm-provider.factory';

/** provider 以 token 注入，測試與日後模型替換均不改解析流程。 */
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    UsersService,
    AiUserThrottleGuard,
    { provide: LLM_PROVIDER, inject: [ConfigService], useFactory: createLlmProvider },
  ],
})
export class AiModule {}
