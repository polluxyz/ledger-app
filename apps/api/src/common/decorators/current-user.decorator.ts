import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@ledger/shared';

/**
 * 把已驗證使用者的 JWT payload（由 JwtAuthGuard 掛在 request 上）注入到
 * controller 方法的參數。用法：`@CurrentUser() user: JwtPayload`。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
