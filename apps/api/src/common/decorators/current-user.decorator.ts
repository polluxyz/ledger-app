import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@ledger/shared';

/**
 * Injects the authenticated user's JWT payload (set on the request by
 * JwtAuthGuard) into a controller method parameter.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
