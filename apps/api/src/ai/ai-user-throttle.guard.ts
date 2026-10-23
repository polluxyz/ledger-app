import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerStorage,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { JwtPayload } from '@ledger/shared';

/** 以已驗證 JWT 的使用者計數；獨立名稱不會改變全域每 IP 的 default 計數。 */
@Injectable()
export class AiUserThrottleGuard extends ThrottlerGuard {
  // 保留父類別的注入位置，避免繼承的 Nest metadata 把 storage 注入 reflector。
  constructor(
    @InjectThrottlerOptions() _options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(
      {
        throttlers: [{ name: 'ai-user', ttl: 60_000, limit: 10 }],
        skipIf: () => process.env.NODE_ENV === 'test',
      },
      storage,
      reflector,
    );
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (!req.user?.sub) throw new UnauthorizedException();
    return super.canActivate(context);
  }

  protected override getTracker(req: { user?: JwtPayload }): Promise<string> {
    if (!req.user?.sub) throw new UnauthorizedException();
    return Promise.resolve(req.user.sub);
  }
}
