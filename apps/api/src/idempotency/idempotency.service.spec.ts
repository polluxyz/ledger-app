import { ErrorCode } from '@ledger/shared';
import { Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService, parseIdempotencyKey, requestHash } from './idempotency.service';

const params = {
  userId: 'user',
  key: 'key',
  operation: 'TRANSACTION_CREATE' as const,
  scopeId: 'ledger',
  requestHash: 'v1:hash',
};
const keyConflict = (
  meta: Record<string, unknown> = {
    modelName: 'IdempotencyKey',
    driverAdapterError: {
      cause: {
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['"userId"', 'key'] },
      },
    },
  },
) =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '7.8.0',
    meta,
  });

/** 用交易替身驗證插入順序與回滾邊界，唯一衝突形狀另由 e2e 實測。 */
describe('IdempotencyService', () => {
  const tx = { idempotencyKey: { create: jest.fn(), update: jest.fn() } };
  const prisma = { $transaction: jest.fn(), idempotencyKey: { findUnique: jest.fn() } };
  const service = new IdempotencyService(prisma as unknown as PrismaService);
  const write = jest.fn();
  const replay = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    tx.idempotencyKey.create.mockResolvedValue({ id: 'row' });
    prisma.$transaction.mockImplementation((fn: (client: unknown) => Promise<unknown>) => fn(tx));
    prisma.idempotencyKey.findUnique.mockResolvedValue({ ...params, resultId: 'result' });
    write.mockResolvedValue('result');
    replay.mockResolvedValue({ id: 'result' });
  });

  it('claims the key before writing and fills the result before commit', async () => {
    expect(await service.run(params, write, replay)).toEqual({ created: true, resultId: 'result' });
    expect(tx.idempotencyKey.create).toHaveBeenCalledWith({
      data: { ...params, resultType: 'TRANSACTION', resultId: null },
    });
    expect(write).toHaveBeenCalledWith(tx);
    expect(tx.idempotencyKey.create.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0]!,
    );
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(
      tx.idempotencyKey.update.mock.invocationCallOrder[0]!,
    );
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
      where: { id: 'row' },
      data: { resultId: 'result' },
    });
    expect(replay).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('replays only after the transaction rejects a key conflict', async () => {
    prisma.$transaction.mockRejectedValue(keyConflict());
    expect(await service.run(params, write, replay)).toEqual({
      created: false,
      response: { id: 'result' },
    });
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user', key: 'key' } },
    });
    expect(replay).toHaveBeenCalledWith('result');
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    { modelName: 'Transaction', target: ['userId', 'key'] },
    { modelName: 'IdempotencyKey', target: ['userId', 'key'] },
    {
      modelName: 'IdempotencyKey',
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { fields: ['id'] },
        },
      },
    },
    {},
  ])('propagates other or unknown P2002 metadata: %j', async (meta) => {
    const error = keyConflict(meta);
    prisma.$transaction.mockRejectedValue(error);
    await expect(service.run(params, write, replay)).rejects.toBe(error);
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it.each(['operation', 'scopeId', 'requestHash'])('rejects a different %s', async (field) => {
    prisma.$transaction.mockRejectedValue(keyConflict());
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      ...params,
      resultId: 'result',
      [field]: 'different',
    });
    await expect(service.run(params, write, replay)).rejects.toMatchObject({
      errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED,
    });
    expect(replay).not.toHaveBeenCalled();
  });

  it.each([null, undefined, '', ' '])(
    'rejects an empty result within the transaction: %s',
    async (result) => {
      write.mockResolvedValue(result);
      await expect(service.run(params, write, replay)).rejects.toThrow(
        'did not return a result id',
      );
      expect(tx.idempotencyKey.update).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    },
  );

  it('propagates business errors without replay', async () => {
    const error = new Error('business');
    write.mockRejectedValue(error);
    await expect(service.run(params, write, replay)).rejects.toBe(error);
    expect(replay).not.toHaveBeenCalled();
  });

  it('refuses a committed key without a result and does not log the key', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.$transaction.mockRejectedValue(keyConflict());
    prisma.idempotencyKey.findUnique.mockResolvedValue({ ...params, resultId: null });
    await expect(service.run(params, write, replay)).rejects.toThrow('result is missing');
    expect(replay).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      userId: params.userId,
      operation: params.operation,
      scopeId: params.scopeId,
      resultType: undefined,
      message: 'Committed idempotency result is missing.',
    });
    expect(log.mock.calls[0]![0]).not.toHaveProperty('key');
    log.mockRestore();
  });
});

/** 格式驗證與正規化以等價輸入、不同順序及非資料型別驗證。 */
describe('Idempotency input', () => {
  it.each([
    undefined,
    '',
    'uuid',
    ['abc'],
    '00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000000',
  ])('rejects invalid header %j', (raw) => {
    let caught: unknown;
    try {
      parseIdempotencyKey(raw);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 400, errorCode: ErrorCode.IDEMPOTENCY_KEY_INVALID });
  });
  it('normalizes uppercase UUIDs', () => {
    expect(parseIdempotencyKey('ABCDEF00-ABCD-ABCD-ABCD-ABCDEF000000')).toBe(
      'abcdef00-abcd-abcd-abcd-abcdef000000',
    );
  });
  it('sorts object fields recursively and omits undefined values', () => {
    expect(requestHash({ b: { d: 2, c: 1 }, a: 0, absent: undefined })).toBe(
      requestHash({ a: 0, b: { c: 1, d: 2 } }),
    );
    expect(requestHash({})).toMatch(/^v1:[0-9a-f]{64}$/);
  });
  it('preserves array order', () => {
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });
  it('uses ISO dates including DTO instances', () => {
    class Input {
      date = new Date('2026-11-17T00:00:00Z');
    }
    expect(requestHash(new Input())).toBe(requestHash({ date: '2026-11-17T00:00:00.000Z' }));
  });
  it.each([new Map(), new Set(), 1n, () => 1, NaN, Infinity, Symbol('value')])(
    'rejects unsupported values: %s',
    (value) => {
      expect(() => requestHash({ value })).toThrow(TypeError);
    },
  );
});
