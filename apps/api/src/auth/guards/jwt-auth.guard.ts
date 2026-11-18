import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '@ledger/shared';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** 簽章有效不代表內容可信；舊憑證與型別錯誤必須在查詢資料庫前拒絕。 */
function isSessionPayload(value: unknown): value is JwtPayload & { exp: number } {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    ['sub', 'email', 'sid'].every(
      (key) => typeof payload[key] === 'string' && payload[key].length > 0,
    ) &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp)
  );
}

/**
 * 全域 guard：除非路由標了 @Public()，否則每個路由都需要合法的 JWT 與有效登入紀錄。
 * 驗證成功後，會把解出的 payload 掛到 request.user 上，供後續 handler 與
 * @CurrentUser() 裝飾器取用。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 讀取 @Public() 寫入的 metadata（方法層優先於類別層）；標為 public 的路由
    // 直接放行，不驗 token。
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync<object>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!isSessionPayload(payload)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // 資料庫故障必須原樣交給全域 filter 回 500，不能誤判成憑證失效。
    const session = await this.prisma.authSession.findUnique({ where: { id: payload.sid } });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    (request as Request & { user: JwtPayload }).user = {
      sub: payload.sub,
      email: payload.email,
      sid: payload.sid,
    };
    return true;
  }

  // 從 `Authorization: Bearer <token>` 標頭取出 token；格式不符則回 undefined。
  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
