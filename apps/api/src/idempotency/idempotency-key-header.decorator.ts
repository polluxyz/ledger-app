import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER } from '@ledger/shared';
import type { Request } from 'express';

/** 只取原始標頭；格式驗證在 controller 本體執行，避免搶在 DTO 驗證前。 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | string[] | undefined =>
    context.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()],
);
