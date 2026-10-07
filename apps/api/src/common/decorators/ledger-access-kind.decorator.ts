import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type LedgerAccess = 'MEMBER' | 'LEFT';

/** 讀取 guard 判定的存取型態，讓 service 對已退出者套用唯讀範圍。 */
export const LedgerAccessKind = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): LedgerAccess =>
    ctx.switchToHttp().getRequest<{ ledgerAccess: LedgerAccess }>().ledgerAccess,
);
