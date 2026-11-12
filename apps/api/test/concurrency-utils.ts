import { setTimeout } from 'node:timers/promises';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/** 將等候點與放行動作分開，讓測試能明確指定請求交錯的位置。 */
export function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** 用真實資料列鎖安排交錯順序；等資料庫確認請求阻塞後才放行，不靠固定延遲猜測。 */
export async function holdLock(
  prisma: PrismaService,
  acquire: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<{ release: () => Promise<void> }> {
  const ready = deferred();
  const released = deferred();
  const running = prisma.$transaction(
    async (tx) => {
      await acquire(tx);
      ready.resolve();
      await released.promise;
    },
    { timeout: 15000 },
  );
  void running.catch(ready.reject);
  await ready.promise;
  return {
    release: async () => {
      released.resolve();
      await running;
    },
  };
}

/** 每套測試只用自己的資料庫，因此只統計該資料庫正在等鎖的連線。 */
export async function waitForBlockedQueries(
  prisma: PrismaService,
  minimum: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!signal?.aborted && Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (row!.count >= minimum) return;
    await setTimeout(10);
  }
  if (signal?.aborted) return;
  throw new Error(`Expected at least ${minimum} blocked database queries.`);
}
