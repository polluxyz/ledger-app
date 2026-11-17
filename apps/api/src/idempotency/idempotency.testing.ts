import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdempotencyService } from './idempotency.service';

/** 既有領域單元測試只驗首次寫入；防重流程由自己的單元測試與 e2e 驗證。 */
export function createIdempotencyStub(prisma: PrismaService): IdempotencyService {
  return {
    run: async (_params: unknown, write: (tx: Prisma.TransactionClient) => Promise<string>) => ({
      created: true,
      resultId: await prisma.$transaction(write),
    }),
  } as unknown as IdempotencyService;
}
