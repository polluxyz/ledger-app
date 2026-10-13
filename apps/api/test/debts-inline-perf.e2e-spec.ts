import { INestApplication } from '@nestjs/common';
import type { Counterparty, Paginated } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/**
 * `hasHistory` 的效能量測（3g plan §3 的風險項：這個參數要看每個對象的全部紀錄）。
 *
 * 策略：一位使用者、100 個對象、每個 20 筆往來紀錄（直接用 Prisma `createMany` 灌資料，
 * 不打 API——量的是查詢，不是寫入）。其中前 50 個對象中間有歸零（該出現在歷史分頁），
 * 後 50 個從沒歸零（不該出現）。對 `GET /counterparties?hasHistory=true&limit=100`
 * 先打一次暖身，再量 5 次取中位數；斷言結果正確（剛好 50 個）且中位數低於寬鬆上限
 * （CI 機器較慢，1500ms；本機目標見 plan 的 500ms）。實際數字用 console.log 印出，
 * 供驗收時記進實作紀錄。
 */
describe('Debts inline hasHistory performance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const COUNTERPARTY_COUNT = 100;
  const ENTRIES_PER_COUNTERPARTY = 20;
  const WITH_HISTORY = 50;

  it('100 個對象各 20 筆紀錄時，hasHistory 回剛好 50 個且中位數低於上限', async () => {
    const { token, userId } = await registerAndLogin(app, 'perf@example.com', 'Perf');

    // 灌資料：名字補零編號，斷言時靠名字分辨「該有歷史」的前 50 個。
    const counterparties = Array.from({ length: COUNTERPARTY_COUNT }, (_, i) => ({
      ownerId: userId,
      name: `對象 ${String(i).padStart(3, '0')}`,
    }));
    await prisma.counterparty.createMany({ data: counterparties });
    const created = await prisma.counterparty.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
    });
    const idByName = new Map(created.map((row) => [row.name, row.id]));

    // 每個對象 20 筆，日期逐筆錯開（同資料庫交易裡 createdAt 只到毫秒，排序要靠日期）。
    // 前 50 個：前 10 筆 +1000/−1000 交錯（歸零多次），後 10 筆再借 1000——有歷史、
    // 餘額 10000。後 50 個：一路 +1000——從沒歸零，餘額 20000。
    const entries = Array.from({ length: COUNTERPARTY_COUNT }, (_, i) => i).flatMap((i) =>
      Array.from({ length: ENTRIES_PER_COUNTERPARTY }, (_, j) => {
        const delta = i < WITH_HISTORY && j < 10 ? (j % 2 === 0 ? 1000 : -1000) : 1000;
        return {
          counterpartyId: idByName.get(`對象 ${String(i).padStart(3, '0')}`)!,
          kind: delta > 0 ? ('LEND' as const) : ('COLLECT' as const),
          delta,
          date: new Date(Date.UTC(2026, 2, 1 + j)),
        };
      }),
    );
    await prisma.debtEntry.createMany({ data: entries });

    const call = () =>
      request(server())
        .get('/api/counterparties')
        .query({ hasHistory: 'true', limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .then((res) => res.body as Paginated<Counterparty>);

    // 暖身兼驗正確性：剛好 50 個，且正是中間有歸零的那 50 個。
    const warm = await call();
    expect(warm.total).toBe(WITH_HISTORY);
    expect(warm.items).toHaveLength(WITH_HISTORY);
    expect(new Set(warm.items.map((row) => row.name))).toEqual(
      new Set(Array.from({ length: WITH_HISTORY }, (_, i) => `對象 ${String(i).padStart(3, '0')}`)),
    );

    // 量 5 次取中位數。supertest 走的是應用程式內建的 HTTP server，含序列化成本，
    // 與前端實際打到 API 的路徑一致（只差沒有網路往返）。
    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = process.hrtime.bigint();
      const page = await call();
      expect(page.total).toBe(WITH_HISTORY);
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    const median = [...samples].sort((a, b) => a - b)[2]!;
    // 量測結果要進驗收紀錄，CI 也看得到。
    console.log(
      `[debts-inline-perf] hasHistory（100 對象 × 20 筆）5 次回應時間：` +
        `${samples.map((ms) => `${ms.toFixed(0)}ms`).join('、')}，中位數 ${median.toFixed(1)}ms`,
    );
    expect(median).toBeLessThan(1500);
  });
});
