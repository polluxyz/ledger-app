import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import {
  Prisma,
  type IdempotencyOperation,
  type IdempotencyResultType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 驗證放在 controller 本體，讓認證、角色與 DTO 驗證先完成。 */
export function parseIdempotencyKey(raw: string | string[] | undefined): string {
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_INVALID,
      'A single UUID Idempotency-Key header is required.',
    );
  }
  return raw.toLowerCase();
}

/** 正規化 DTO 的欄位順序；陣列的順序仍代表請求內容，不可排序。 */
export function requestHash(input: unknown): string {
  return (
    'v1:' +
    createHash('sha256')
      .update(JSON.stringify(normalize(input)))
      .digest('hex')
  );
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.filter((item) => item !== undefined).map(normalize);
  // ValidationPipe 產生的 DTO 是 class 實例；拒絕 Map 等非資料物件。
  if (typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  throw new TypeError('Unsupported idempotency hash input.');
}

interface RunParams {
  userId: string;
  key: string;
  operation: IdempotencyOperation;
  scopeId: string | null;
  requestHash: string;
}

const RESULT_TYPES: Record<IdempotencyOperation, IdempotencyResultType> = {
  TRANSACTION_CREATE: 'TRANSACTION',
  DEBT_ENTRY_CREATE: 'DEBT_ENTRY',
  SPLIT_CREATE: 'SPLIT',
  SETTLEMENT_CREATE: 'TRANSACTION',
  COUNTERPARTY_FORGIVE: 'DEBT_ENTRY',
};

/** 搶鍵、業務寫入、填結果共用同一個交易；唯一衝突只在回滾後處理。 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    params: RunParams,
    write: (tx: Prisma.TransactionClient) => Promise<string>,
    replay: (resultId: string) => Promise<T>,
  ): Promise<{ created: true; resultId: string } | { created: false; response: T }> {
    try {
      const resultId = await this.prisma.$transaction(async (tx) => {
        const row = await tx.idempotencyKey.create({
          data: { ...params, resultType: RESULT_TYPES[params.operation], resultId: null },
        });
        const id = await write(tx);
        if (typeof id !== 'string' || id.trim().length === 0)
          throw new Error('Idempotency write did not return a result id.');
        await tx.idempotencyKey.update({ where: { id: row.id }, data: { resultId: id } });
        return id;
      });
      return { created: true, resultId };
    } catch (error: unknown) {
      if (!isKeyConflict(error)) throw error;
    }

    const row = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: params.userId, key: params.key } },
    });
    if (!row) throw new Error('Committed idempotency key was not found.');
    if (
      row.operation !== params.operation ||
      row.scopeId !== params.scopeId ||
      row.requestHash !== params.requestHash
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This idempotency key has already been used for a different request.',
      );
    }
    if (row.resultId === null) {
      // 不記錄鍵與請求內容；這代表交易內填回結果的保證遭到破壞。
      this.logger.error({
        userId: row.userId,
        operation: row.operation,
        scopeId: row.scopeId,
        resultType: row.resultType,
        message: 'Committed idempotency result is missing.',
      });
      throw new Error('Committed idempotency result is missing.');
    }
    return { created: false, response: await replay(row.resultId) };
  }
}

/** 只接受 Prisma 7.8 + pg 實測的鍵表索引形狀；不明的唯一衝突必須往外丟。 */
function isKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const meta = error.meta;
  if (meta?.modelName !== 'IdempotencyKey') return false;
  const adapter = meta.driverAdapterError;
  if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter)) return false;
  const cause = adapter.cause;
  if (
    typeof cause !== 'object' ||
    cause === null ||
    !('constraint' in cause) ||
    !('kind' in cause) ||
    cause.kind !== 'UniqueConstraintViolation' ||
    !('originalCode' in cause) ||
    cause.originalCode !== '23505'
  )
    return false;
  const constraint = cause.constraint;
  if (typeof constraint !== 'object' || constraint === null || !('fields' in constraint))
    return false;
  const fields = constraint.fields;
  return (
    Array.isArray(fields) && fields.length === 2 && fields[0] === '"userId"' && fields[1] === 'key'
  );
}

/** 已刪除的結果保留鍵，不得因重送而重建資源。 */
export function idempotencyResourceDeleted(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.IDEMPOTENCY_RESOURCE_DELETED,
    'The resource created by this request has been deleted.',
  );
}
