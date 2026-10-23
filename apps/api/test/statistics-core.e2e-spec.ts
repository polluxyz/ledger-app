import type { INestApplication } from '@nestjs/common';
import type { StatisticsPerspective } from '@ledger/shared';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { attributeTransactions } from '../src/statistics/attribution';
import type { AttributionRow } from '../src/statistics/attribution';
import { allocatePercentageBps } from '../src/statistics/percentage-bps';
import {
  safeStatisticsInteger,
  statisticsAttributionCte,
  statisticsGroupsSql,
  statisticsPeopleSql,
  statisticsTotalsFromRow,
  statisticsTotalsSql,
  statisticsTrendSql,
} from '../src/statistics/statistics-sql';
import type {
  StatisticsGroupRow,
  StatisticsPersonRow,
  StatisticsPerspectiveTotalsRow,
  StatisticsScope,
  StatisticsTotalsRow,
  StatisticsTrendRow,
} from '../src/statistics/statistics-sql';
import { taipeiDatePeriod, taipeiMonthPeriod, taipeiMonths } from '../src/statistics/taipei-period';
import { createE2EApp, resetDb } from './e2e-utils';
import {
  createStatisticsAttributionShapes,
  createStatisticsExamples,
  readStatisticsReference,
} from './statistics-fixtures';

const perspectives: StatisticsPerspective[] = ['LEDGER', 'MINE'];
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rowKey = (row: AttributionRow) => `${row.transactionId}:${row.personId}`;

/** 測試端的獨立逐列 BigInt 加總，不呼叫正式 SQL 或 service 的彙總實作。 */
function totals(rows: readonly AttributionRow[]): StatisticsTotalsRow {
  return rows.reduce(
    (result, row) => {
      if (row.direction === 'INCOME') result.income += row.amount;
      else result.expense += row.amount;
      return result;
    },
    { income: 0n, expense: 0n },
  );
}

async function sqlSnapshot(tx: Prisma.TransactionClient, scope: StatisticsScope) {
  const totalsRows = await tx.$queryRaw<StatisticsPerspectiveTotalsRow[]>(
    statisticsTotalsSql(scope),
  );
  const people = await tx.$queryRaw<StatisticsPersonRow[]>(statisticsPeopleSql(scope));
  const groups = {} as Record<StatisticsPerspective, StatisticsGroupRow[]>;
  const trend = {} as Record<StatisticsPerspective, StatisticsTrendRow[]>;
  for (const perspective of perspectives) {
    groups[perspective] = await tx.$queryRaw<StatisticsGroupRow[]>(
      statisticsGroupsSql(scope, perspective),
    );
    trend[perspective] = await tx.$queryRaw<StatisticsTrendRow[]>(
      statisticsTrendSql(scope, perspective),
    );
  }
  return { totalsRows, people, groups, trend };
}

/** 將真實 SQL 的每列歸屬與四種彙總，逐一對照純函式及不變量，避免只看總額巧合相同。 */
async function expectSqlMatchesReference(tx: Prisma.TransactionClient, scope: StatisticsScope) {
  const input = await readStatisticsReference(tx, scope.ledgerId);
  const rows = attributeTransactions(input.transactions, input.people, scope);
  const actualRows = await tx.$queryRaw<
    AttributionRow[]
  >(Prisma.sql`${statisticsAttributionCte(scope)}
    SELECT "transactionId", "personId", name, "isMe", amount, direction, kind, "categoryId", key,
      to_char(("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS month
    FROM attribution`);
  expect(actualRows.sort((a, b) => textOrder(rowKey(a), rowKey(b)))).toEqual(
    [...rows].sort((a, b) => textOrder(rowKey(a), rowKey(b))),
  );
  const actual = await sqlSnapshot(tx, scope);
  const ledgerTotal = totals(rows);
  const mineTotal = totals(rows.filter((row) => row.isMe));
  expect(actual.totalsRows).toEqual([
    { perspective: 'LEDGER', ...ledgerTotal },
    { perspective: 'MINE', ...mineTotal },
  ]);
  // 帳本總額另以原交易全額逐筆加總，防止兩個實作恰好一起把份額乘多或漏掉。
  const eligible = input.transactions.filter(
    (t) => t.deletedAt === null && t.date >= scope.start && t.date < scope.end,
  );
  for (const [direction, field] of [
    ['INCOME', 'income'],
    ['EXPENSE', 'expense'],
  ] as const) {
    expect(ledgerTotal[field]).toBe(
      eligible.filter((t) => t.type === direction).reduce((sum, t) => sum + BigInt(t.amount), 0n),
    );
  }
  const expectedPeople = [...new Set(rows.map((row) => row.personId))]
    .map((personId) => {
      const personRows = rows.filter((row) => row.personId === personId);
      return {
        personId,
        name: personRows[0]!.name,
        isMe: personRows[0]!.isMe,
        ...totals(personRows),
      };
    })
    .filter((p) => p.income > 0n || p.expense > 0n)
    .sort((a, b) =>
      a.expense === b.expense ? textOrder(a.personId, b.personId) : a.expense > b.expense ? -1 : 1,
    );
  expect(actual.people).toEqual(expectedPeople);
  expect(actual.people.reduce((sum, p) => sum + p.expense, 0n)).toBe(ledgerTotal.expense);
  expect(actual.people.reduce((sum, p) => sum + p.income, 0n)).toBe(ledgerTotal.income);
  for (const field of ['income', 'expense'] as const) {
    expect(actual.people.filter((p) => p.isMe).reduce((sum, p) => sum + p[field], 0n)).toBe(
      mineTotal[field],
    );
  }
  for (const perspective of perspectives) {
    const selected = perspective === 'MINE' ? rows.filter((row) => row.isMe) : rows;
    const expectedGroups = new Map<string, bigint>();
    for (const row of selected) {
      const key = `${row.direction}:${row.key}`;
      expectedGroups.set(key, (expectedGroups.get(key) ?? 0n) + row.amount);
    }
    expect(
      actual.groups[perspective].map((row) => [`${row.direction}:${row.key}`, row.amount]).sort(),
    ).toEqual([...expectedGroups].filter(([, amount]) => amount > 0n).sort());
    for (const [direction, field] of [
      ['INCOME', 'income'],
      ['EXPENSE', 'expense'],
    ] as const) {
      const directionGroups = actual.groups[perspective].filter((g) => g.direction === direction);
      const amounts = allocatePercentageBps(
        directionGroups.map((group) => ({
          key: group.key,
          amount: safeStatisticsInteger(group.amount),
        })),
      );
      expect(amounts.reduce((sum, group) => sum + group.percentageBps, 0)).toBe(
        amounts.length ? 10000 : 0,
      );
      expect(directionGroups.reduce((sum, group) => sum + group.amount, 0n)).toBe(
        totals(selected)[field],
      );
    }
    const expectedTrend = [...new Set(selected.map((row) => row.month))]
      .sort()
      .map((month) => ({ month, ...totals(selected.filter((row) => row.month === month)) }));
    expect(actual.trend[perspective]).toEqual(expectedTrend);
    for (const row of actual.trend[perspective]) statisticsTotalsFromRow(row);
  }
  return { actual, rows };
}

/** 真 PostgreSQL 的差異測試；只連此 worktree 專用的測試資料庫，不依賴統計端點存在。 */
describe('Statistics attribution core (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  it('reproduces 日常 and 家用 totals, groups, people and both perspectives', async () => {
    const examples = await createStatisticsExamples(app, prisma);
    await prisma.$transaction(async (tx) => {
      const dailyScope = {
        ledgerId: examples.dailyLedgerId,
        userId: examples.me.userId,
        ...taipeiMonthPeriod('2026-10'),
      };
      const daily = await expectSqlMatchesReference(tx, dailyScope);
      expect(daily.actual.totalsRows.map(statisticsTotalsFromRow)).toEqual([
        { income: 5000000, expense: 70300, net: 4929700 },
        { income: 5000000, expense: 70300, net: 4929700 },
      ]);
      expect(
        daily.actual.groups.LEDGER.filter((g) => g.direction === 'EXPENSE').map((g) => [
          g.kind,
          g.amount,
        ]),
      ).toEqual([
        ['BAD_DEBT', 50000n],
        ['CATEGORY', 12000n],
        ['CATEGORY', 8000n],
        ['DIFFERENCE', 300n],
      ]);
      const homeScope = { ...dailyScope, ledgerId: examples.homeLedgerId };
      const home = await expectSqlMatchesReference(tx, homeScope);
      expect(home.actual.totalsRows.map(statisticsTotalsFromRow)).toEqual([
        { income: 20000, expense: 120000, net: -100000 },
        { income: 20000, expense: 45000, net: -25000 },
      ]);
      expect(home.actual.people.map((p) => [p.name, p.expense, p.income])).toEqual([
        ['小美', 75000n, 0n],
        ['我', 45000n, 20000n],
      ]);
      expect(
        allocatePercentageBps(
          home.actual.groups.LEDGER.filter((g) => g.direction === 'EXPENSE').map((g) => ({
            key: g.key,
            amount: safeStatisticsInteger(g.amount),
          })),
        ).map((g) => g.percentageBps),
      ).toEqual([7500, 2500]);
      const months = taipeiMonths('2026-10');
      const trend = await tx.$queryRaw<StatisticsTrendRow[]>(
        statisticsTrendSql({ ...homeScope, start: taipeiMonthPeriod(months[0]!).start }, 'MINE'),
      );
      const filled = months.map((month) => ({
        month,
        ...statisticsTotalsFromRow(
          trend.find((row) => row.month === month) ?? { income: 0n, expense: 0n },
        ),
      }));
      expect(filled).toHaveLength(12);
      expect(filled.slice(0, 11).every((row) => row.income === 0 && row.expense === 0)).toBe(true);
      expect(filled[11]).toEqual({ month: '2026-10', income: 20000, expense: 45000, net: -25000 });
    });
  });

  it('covers every SC-R28 shape and identities, and ignores the database session time zone', async () => {
    const examples = await createStatisticsExamples(app, prisma);
    const shapes = await createStatisticsAttributionShapes(app, prisma, examples);
    const period = taipeiDatePeriod('2026-09-01', '2026-11-30');
    const snapshots: Array<{
      scope: StatisticsScope;
      result: Awaited<ReturnType<typeof expectSqlMatchesReference>>;
    }> = [];
    for (const ledgerId of [examples.dailyLedgerId, examples.homeLedgerId]) {
      for (const userId of [examples.me.userId, examples.mei.userId, shapes.left.userId]) {
        const scope = { ledgerId, userId, ...period };
        snapshots.push({
          scope,
          result: await prisma.$transaction((tx) => expectSqlMatchesReference(tx, scope)),
        });
      }
    }
    const meRows = snapshots
      .filter((s) => s.scope.userId === examples.me.userId)
      .flatMap((s) => s.result.rows);
    for (const [name, shape] of Object.entries(shapes.cases)) {
      const allocations = meRows
        .filter((row) => row.transactionId === shape.transactionId)
        .map(({ personId, amount }) => ({ personId, amount }))
        .sort((a, b) => textOrder(a.personId, b.personId));
      expect({ name, allocations }).toEqual({
        name,
        allocations: [...shape.allocations].sort((a, b) => textOrder(a.personId, b.personId)),
      });
    }
    // 在同一條連線、同一交易先換時區，才執行所有統計；不讓 pool 換連線掩蓋錯誤。
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
        const timezone = await tx.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIME ZONE`;
        expect(timezone[0]?.TimeZone).toBe('America/New_York');
        for (const snapshot of snapshots) {
          const changed = await expectSqlMatchesReference(tx, snapshot.scope);
          expect(changed.actual).toEqual(snapshot.result.actual);
        }
      },
      { timeout: 30000 },
    );
    const homeScope = {
      ledgerId: examples.homeLedgerId,
      userId: examples.me.userId,
      ...taipeiMonthPeriod('2026-10'),
    };
    const october = await prisma.$transaction((tx) => expectSqlMatchesReference(tx, homeScope));
    expect(
      october.rows.some((row) => row.transactionId === shapes.cases.lateOctober!.transactionId),
    ).toBe(true);
    expect(
      october.rows.some((row) => row.transactionId === shapes.cases.earlyNovember!.transactionId),
    ).toBe(false);
    const november = await prisma.$transaction((tx) =>
      expectSqlMatchesReference(tx, { ...homeScope, ...taipeiMonthPeriod('2026-11') }),
    );
    expect(
      november.rows.some((row) => row.transactionId === shapes.cases.earlyNovember!.transactionId),
    ).toBe(true);
  });

  it('returns zero totals and empty collections for an empty period, and rejects unsafe database sums', async () => {
    const examples = await createStatisticsExamples(app, prisma);
    const { actual } = await prisma.$transaction((tx) =>
      expectSqlMatchesReference(tx, {
        ledgerId: examples.homeLedgerId,
        userId: examples.me.userId,
        ...taipeiMonthPeriod('2025-01'),
      }),
    );
    expect(actual.totalsRows.map(statisticsTotalsFromRow)).toEqual(
      Array(2).fill({ income: 0, expense: 0, net: 0 }),
    );
    expect(actual.people).toEqual([]);
    expect(actual.groups.LEDGER).toEqual([]);
    const sums = await prisma.$queryRaw<
      Array<{ amount: bigint }>
    >`SELECT SUM(value)::bigint AS amount FROM (VALUES (9007199254740991::bigint), (1::bigint)) amounts(value)`;
    expect(() => safeStatisticsInteger(sums[0]!.amount)).toThrow(RangeError);
  });
});
