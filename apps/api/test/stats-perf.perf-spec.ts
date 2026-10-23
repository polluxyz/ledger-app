import { execFileSync } from 'node:child_process';
import { cpus, platform, totalmem } from 'node:os';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  statisticsGroupsSql,
  statisticsPeopleSql,
  statisticsTotalsSql,
  statisticsTrendSql,
} from '../src/statistics/statistics-sql';
import { taipeiDatePeriod, taipeiMonthPeriod, taipeiMonths } from '../src/statistics/taipei-period';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';

const TRANSACTION_COUNT = 10_000;
const HISTORICAL_TRANSACTION_COUNT = 36;
const BATCH_SIZE = 1_000;
const SEED = 0x2a2026;
const PERF_FROM = '2026-01-01';
const PERF_TO = '2026-12-31';
const PERF_END_MONTH = '2026-10';

type IncomeExpenseType = 'EXPENSE' | 'INCOME';
type SeedShape =
  | 'ordinary'
  | 'split'
  | 'difference-parent'
  | 'difference-branch'
  | 'bad-debt'
  | 'debt-forgiven'
  | 'settlement';

interface SeedMember {
  userId: string;
  name: string;
  personId: string;
  counterpartyId: string;
  cashAccountId: string;
  temporaryAccountId: string;
}

interface SeedTransaction {
  index: number;
  shape: SeedShape;
  data: Prisma.TransactionCreateManyInput;
}

interface Measurement {
  name: string;
  min: number;
  median: number;
  p95: number;
  max: number;
}

function assertTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  let databaseName = '(unavailable)';
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    // 連線字串含密碼，拒絕時只顯示資料庫名稱或固定代稱。
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to seed performance data: database "${databaseName}" does not end with "_test".`,
    );
  }
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createIdFactory(): () => string {
  let next = 1;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}

function randomIndex(random: () => number, length: number): number {
  return Math.floor(random() * length);
}

function transactionDate(index: number, random: () => number): Date {
  if (index < HISTORICAL_TRANSACTION_COUNT) {
    const firstMonth = 2022 * 12 + 10; // 2022-11；共 36 個月直到 2025-10。
    const monthIndex = firstMonth + index;
    return new Date(Date.UTC(Math.floor(monthIndex / 12), monthIndex % 12, 15, 12));
  }

  const start = Date.UTC(2025, 10, 1, 12);
  const end = Date.UTC(2026, 10, 1, 12);
  return new Date(start + Math.floor(random() * (end - start)));
}

function shapeAt(index: number): SeedShape {
  const bucket = index % 100;
  if (bucket < 70 || bucket >= 90) return 'ordinary';
  if (bucket < 85) return 'split';
  if (bucket === 85) return 'difference-parent';
  if (bucket === 86) return 'difference-branch';
  if (bucket === 87) return 'bad-debt';
  if (bucket === 88) return 'debt-forgiven';
  return 'settlement';
}

async function createManyInBatches<T>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await insert(rows.slice(offset, offset + BATCH_SIZE));
  }
}

async function seedPerformanceData(
  prisma: PrismaService,
): Promise<{ ledgerId: string; userId: string; token: string; counts: string[] }> {
  const createId = createIdFactory();
  const random = mulberry32(SEED);
  const userId = createId();
  const email = 'stats-perf@example.com';
  const extraMembers = [
    { userId: createId(), name: 'Statistics Perf Member 1' },
    { userId: createId(), name: 'Statistics Perf Member 2' },
  ];
  const passwordHash = await bcrypt.hash('stats-perf-fixture-password', 10);
  await prisma.user.createMany({
    data: [
      { id: userId, email, passwordHash, name: 'Statistics Perf Owner' },
      ...extraMembers.map((member) => ({
        id: member.userId,
        email: `${member.userId.slice(-12)}@stats-perf.example.test`,
        passwordHash,
        name: member.name,
      })),
    ],
  });
  const token = await app!.get(JwtService).signAsync({ sub: userId, email });
  const primaryCashId = createId();
  const primaryTemporaryId = createId();
  const primarySavingsId = createId();
  const otherAccountIds = extraMembers.map(() => ({ cash: createId(), temporary: createId() }));
  await prisma.account.createMany({
    data: [
      {
        id: primaryCashId,
        userId,
        name: 'Statistics Perf Cash',
        initialBalance: 0,
      },
      {
        id: primaryTemporaryId,
        userId,
        name: 'Statistics Perf Temporary',
        initialBalance: 0,
        isTemporary: true,
      },
      {
        id: primarySavingsId,
        userId,
        name: 'Statistics Perf Savings',
        initialBalance: 3_000_000,
      },
      ...extraMembers.flatMap((member, index) => [
        {
          id: otherAccountIds[index]!.cash,
          userId: member.userId,
          name: 'Statistics Perf Cash',
          initialBalance: 0,
        },
        {
          id: otherAccountIds[index]!.temporary,
          userId: member.userId,
          name: 'Statistics Perf Temporary',
          initialBalance: 0,
          isTemporary: true,
        },
      ]),
    ],
  });

  const ledgerId = createId();
  const members: SeedMember[] = [
    {
      userId,
      name: 'Statistics Perf Owner',
      personId: createId(),
      counterpartyId: createId(),
      cashAccountId: primaryCashId,
      temporaryAccountId: primaryTemporaryId,
    },
    ...extraMembers.map((member, index) => ({
      ...member,
      personId: createId(),
      counterpartyId: createId(),
      cashAccountId: otherAccountIds[index]!.cash,
      temporaryAccountId: otherAccountIds[index]!.temporary,
    })),
  ];

  await prisma.ledger.createMany({
    data: [{ id: ledgerId, name: 'Statistics Performance Shared Ledger', kind: 'SHARED' }],
  });
  await prisma.ledgerMember.createMany({
    data: members.map((member, index) => ({
      ledgerId,
      userId: member.userId,
      role: index === 0 ? 'OWNER' : 'EDITOR',
    })),
  });
  await prisma.ledgerPerson.createMany({
    data: members.map((member) => ({
      id: member.personId,
      ledgerId,
      userId: member.userId,
      name: null,
    })),
  });
  await prisma.counterparty.createMany({
    data: members.map((member, index) => ({
      id: member.counterpartyId,
      ownerId: member.userId,
      name: `Statistics Perf Counterparty ${index + 1}`,
    })),
  });

  const categories: Prisma.CategoryCreateManyInput[] = [
    { id: createId(), ledgerId, name: 'Food', type: 'EXPENSE', sortOrder: 0 },
    { id: createId(), ledgerId, name: 'Home', type: 'EXPENSE', sortOrder: 1 },
    { id: createId(), ledgerId, name: 'Transport', type: 'EXPENSE', sortOrder: 2 },
    { id: createId(), ledgerId, name: 'Salary', type: 'INCOME', sortOrder: 0 },
    { id: createId(), ledgerId, name: 'Other income', type: 'INCOME', sortOrder: 1 },
  ];
  await prisma.category.createMany({ data: categories });
  const categoriesByType = {
    EXPENSE: categories.filter((category) => category.type === 'EXPENSE'),
    INCOME: categories.filter((category) => category.type === 'INCOME'),
  };

  const transactionRecords: SeedTransaction[] = [];
  const differenceParents = new Map<number, { id: string; type: 'COLLECT' | 'REPAY' }>();
  const ledgerSplitRows: Prisma.LedgerSplitCreateManyInput[] = [];
  const ledgerShareRows: Prisma.LedgerShareCreateManyInput[] = [];
  const settlementRows: Prisma.LedgerSettlementCreateManyInput[] = [];
  const debtEntryRows: Prisma.DebtEntryCreateManyInput[] = [];

  for (let index = 0; index < TRANSACTION_COUNT; index += 1) {
    const shape = shapeAt(index);
    const date = transactionDate(index, random);
    const id = createId();
    const amount = 1_000 + randomIndex(random, 100_000);
    let data: Prisma.TransactionCreateManyInput;

    if (shape === 'difference-parent') {
      const member = members[Math.floor(index / 100) % members.length]!;
      const debtType = Math.floor(index / 100) % 2 === 0 ? 'COLLECT' : 'REPAY';
      data = {
        id,
        ledgerId,
        creatorId: member.userId,
        type: debtType,
        amount: 10_000,
        date,
        accountId: member.cashAccountId,
        categoryId: null,
        toAccountId: null,
        title: 'Performance debt settlement',
        note: null,
        payerPersonId: null,
        splitId: null,
        differenceOfId: null,
        deletedAt: null,
      };
      differenceParents.set(index, { id, type: debtType });
      debtEntryRows.push({
        id: createId(),
        counterpartyId: member.counterpartyId,
        kind: debtType,
        delta: debtType === 'COLLECT' ? -10_000 : 10_000,
        date,
        note: null,
        transactionId: id,
      });
    } else if (shape === 'difference-branch') {
      const parentIndex = index - 1;
      const parent = differenceParents.get(parentIndex);
      const member = members[Math.floor(index / 100) % members.length]!;
      if (!parent) throw new Error(`Difference parent is missing for transaction ${index}.`);
      data = {
        id,
        ledgerId,
        creatorId: member.userId,
        type: parent.type === 'COLLECT' ? 'EXPENSE' : 'INCOME',
        amount: 125,
        date: transactionRecords[parentIndex]!.data.date,
        accountId: member.cashAccountId,
        categoryId: null,
        toAccountId: null,
        title: null,
        note: null,
        payerPersonId: null,
        splitId: null,
        differenceOfId: parent.id,
        deletedAt: null,
      };
    } else if (shape === 'bad-debt' || shape === 'debt-forgiven') {
      const member = members[Math.floor(index / 100) % members.length]!;
      const isBadDebt = shape === 'bad-debt';
      data = {
        id,
        ledgerId,
        creatorId: member.userId,
        type: isBadDebt ? 'EXPENSE' : 'INCOME',
        amount,
        date,
        accountId: null,
        categoryId: null,
        toAccountId: null,
        title: null,
        note: null,
        payerPersonId: null,
        splitId: null,
        differenceOfId: null,
        deletedAt: null,
      };
      debtEntryRows.push({
        id: createId(),
        counterpartyId: member.counterpartyId,
        kind: isBadDebt ? 'FORGIVE' : 'FORGIVEN',
        delta: isBadDebt ? -amount : amount,
        date,
        note: null,
        transactionId: id,
      });
    } else if (shape === 'settlement') {
      const from = members[0]!;
      const to = members[1 + (Math.floor(index / 100) % (members.length - 1))]!;
      data = {
        id,
        ledgerId,
        creatorId: from.userId,
        type: 'TRANSFER',
        amount,
        date,
        accountId: from.cashAccountId,
        toAccountId: to.temporaryAccountId,
        categoryId: null,
        title: null,
        note: null,
        payerPersonId: null,
        splitId: null,
        differenceOfId: null,
        deletedAt: null,
      };
      settlementRows.push({
        id: createId(),
        transactionId: id,
        fromPersonId: from.personId,
        toPersonId: to.personId,
      });
    } else {
      const isSplit = shape === 'split';
      const type: IncomeExpenseType = random() < 0.78 ? 'EXPENSE' : 'INCOME';
      const historical = index < HISTORICAL_TRANSACTION_COUNT;
      const creator = historical ? members[0]! : members[randomIndex(random, members.length)]!;
      const payer = historical ? members[0]! : members[randomIndex(random, members.length)]!;
      const accountId = historical
        ? index % 2 === 0
          ? members[0]!.cashAccountId
          : primarySavingsId
        : creator.userId === payer.userId
          ? payer.cashAccountId
          : payer.temporaryAccountId;
      const category = categoriesByType[type][randomIndex(random, categoriesByType[type].length)]!;
      const regularAmount = isSplit ? (Math.floor(amount / 3) + 1) * 3 : amount;
      const deletedAt = !historical && index % 333 === 0 ? new Date() : null;
      data = {
        id,
        ledgerId,
        creatorId: creator.userId,
        type,
        amount: regularAmount,
        date,
        accountId,
        categoryId: category.id,
        toAccountId: null,
        title: `Performance entry ${String(index).padStart(5, '0')}`,
        note: null,
        payerPersonId: payer.personId,
        splitId: null,
        differenceOfId: null,
        deletedAt,
      };

      if (isSplit) {
        const ledgerSplitId = createId();
        ledgerSplitRows.push({
          id: ledgerSplitId,
          transactionId: id,
          method: 'EQUAL',
          precision: 'CENT',
        });
        members.forEach((member, sortOrder) => {
          ledgerShareRows.push({
            id: createId(),
            ledgerSplitId,
            personId: member.personId,
            share: regularAmount / members.length,
            ratio: null,
            sortOrder,
          });
        });
      }
    }

    transactionRecords.push({ index, shape, data });
  }

  const nonBranchTransactions = transactionRecords
    .filter((record) => record.shape !== 'difference-branch')
    .map((record) => record.data);
  const differenceTransactions = transactionRecords
    .filter((record) => record.shape === 'difference-branch')
    .map((record) => record.data);
  await createManyInBatches(nonBranchTransactions, (data) =>
    prisma.transaction.createMany({ data }),
  );
  await createManyInBatches(differenceTransactions, (data) =>
    prisma.transaction.createMany({ data }),
  );
  await createManyInBatches(ledgerSplitRows, (data) => prisma.ledgerSplit.createMany({ data }));
  await createManyInBatches(ledgerShareRows, (data) => prisma.ledgerShare.createMany({ data }));
  await createManyInBatches(settlementRows, (data) => prisma.ledgerSettlement.createMany({ data }));
  await createManyInBatches(debtEntryRows, (data) => prisma.debtEntry.createMany({ data }));

  const splitCount = transactionRecords.filter((record) => record.shape === 'split').length;
  const plainIncomeExpenseCount = transactionRecords.filter(
    (record) =>
      record.shape === 'ordinary' &&
      (record.data.type === 'EXPENSE' || record.data.type === 'INCOME'),
  ).length;
  const differenceParentCount = transactionRecords.filter(
    (record) => record.shape === 'difference-parent',
  ).length;
  const differenceBranchCount = differenceTransactions.length;
  const badDebtCount = debtEntryRows.filter((entry) => entry.kind === 'FORGIVE').length;
  const debtForgivenCount = debtEntryRows.filter((entry) => entry.kind === 'FORGIVEN').length;
  const deletedCount = transactionRecords.filter((record) => record.data.deletedAt !== null).length;
  const historyCount = transactionRecords.filter(
    (record) =>
      record.index < HISTORICAL_TRANSACTION_COUNT &&
      record.data.accountId !== null &&
      (record.data.accountId === primaryCashId || record.data.accountId === primarySavingsId),
  ).length;

  return {
    ledgerId,
    userId,
    token,
    counts: [
      `交易總數：${transactionRecords.length.toLocaleString('en-US')}`,
      `一般收支（有分類）：${(plainIncomeExpenseCount + splitCount).toLocaleString('en-US')}（未分帳 ${plainIncomeExpenseCount.toLocaleString('en-US')}、多人分帳 ${splitCount.toLocaleString('en-US')}）`,
      `結清差額分支：${differenceBranchCount}（父筆 ${differenceParentCount}）`,
      `呆帳 FORGIVE：${badDebtCount}`,
      `債務免除 FORGIVEN：${debtForgivenCount}`,
      `結清轉帳：${settlementRows.length}`,
      `軟刪除交易：${deletedCount}`,
      `主要使用者多年帳戶歷史：${historyCount}（2022-11～2025-10）`,
      `共享帳本成員：${members.length}`,
    ],
  };
}

async function measureEndpoint(name: string, call: () => Promise<number>): Promise<Measurement> {
  for (let warmup = 0; warmup < 5; warmup += 1) {
    expect(await call()).toBe(200);
  }

  const samples: number[] = [];
  for (let run = 0; run < 100; run += 1) {
    const start = process.hrtime.bigint();
    const status = await call();
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    expect(status).toBe(200);
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const measurement = {
    name,
    min: sorted[0]!,
    median: (sorted[49]! + sorted[50]!) / 2,
    p95: sorted[94]!,
    max: sorted[99]!,
  };
  console.log(
    `[stats-perf] ${name}: p95=${measurement.p95.toFixed(1)}ms（索引 94）、` +
      `min=${measurement.min.toFixed(1)}ms、median=${measurement.median.toFixed(1)}ms、` +
      `max=${measurement.max.toFixed(1)}ms`,
  );
  return measurement;
}

async function logExplainPlan(
  client: PrismaService,
  label: string,
  query: Prisma.Sql,
): Promise<void> {
  const rows = await client.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN (ANALYZE, BUFFERS) ${query.text}`,
    ...query.values,
  );
  const highlights = rows
    .map((row) => row['QUERY PLAN'])
    .filter((line) =>
      /Execution Time|Planning Time|Seq Scan|Index Scan|Bitmap|Rows Removed|Buffers:|HashAggregate|GroupAggregate/.test(
        line,
      ),
    );
  console.log(`[stats-perf] EXPLAIN ANALYZE ${label}:\n${highlights.join('\n')}`);
}

async function logSlowEndpointPlans(
  client: PrismaService,
  ledgerId: string,
  userId: string,
  measurements: Measurement[],
): Promise<void> {
  if (measurements[0]!.p95 >= 500) {
    const scope = { ledgerId, userId, ...taipeiDatePeriod(PERF_FROM, PERF_TO) };
    await logExplainPlan(client, 'statistics totals', statisticsTotalsSql(scope));
    await logExplainPlan(client, 'statistics groups', statisticsGroupsSql(scope));
    await logExplainPlan(client, 'statistics people', statisticsPeopleSql(scope));
  }

  if (measurements[1]!.p95 >= 500) {
    const months = taipeiMonths(PERF_END_MONTH, 12);
    const scope = {
      ledgerId,
      userId,
      start: taipeiMonthPeriod(months[0]!).start,
      end: taipeiMonthPeriod(PERF_END_MONTH).end,
    };
    await logExplainPlan(client, 'statistics trend', statisticsTrendSql(scope));
  }

  if (measurements[2]!.p95 >= 500) {
    const accounts = await client.account.findMany({ where: { userId }, select: { id: true } });
    const accountIds = accounts.map((account) => account.id);
    const end = taipeiMonthPeriod(PERF_END_MONTH).end;
    const accountSet = Prisma.join(accountIds);
    await logExplainPlan(
      client,
      'balance trend outgoing group',
      Prisma.sql`SELECT "accountId", "type", SUM("amount")
        FROM "Transaction"
        WHERE "deletedAt" IS NULL AND "accountId" IN (${accountSet}) AND "date" < ${end}
        GROUP BY "accountId", "type"`,
    );
    await logExplainPlan(
      client,
      'balance trend incoming group',
      Prisma.sql`SELECT "toAccountId", SUM("amount")
        FROM "Transaction"
        WHERE "deletedAt" IS NULL AND "type" = 'TRANSFER'
          AND "toAccountId" IN (${accountSet}) AND "date" < ${end}
        GROUP BY "toAccountId"`,
    );
  }
}

let app: INestApplication | undefined;
let prisma: PrismaService;

/**
 * 這支獨立效能測試會清空並重建專屬測試資料庫；先以資料庫名稱拒絕非 `_test` 連線，
 * 再沿用正式服務會寫出的共享帳本、分帳、借還分支與軟刪除形態。
 */
describe('Statistics performance (manual)', () => {
  beforeAll(async () => {
    assertTestDatabase();
    ({ app, prisma } = await createE2EApp());
    await resetDb(prisma);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('measures three statistics endpoints on the fixed 10,000 transaction dataset', async () => {
    const seeded = await seedPerformanceData(prisma);
    console.log(`[stats-perf] 資料形態筆數：\n  ${seeded.counts.join('\n  ')}`);

    const cpuList = cpus();
    const pgVersionRows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(
      `[stats-perf] 執行環境：commit ${commit}；Node ${process.version}；` +
        `PostgreSQL ${pgVersionRows[0]?.version ?? 'unknown'}；CPU ${cpuList[0]?.model ?? 'unknown'}；` +
        `${cpuList.length} 核心；記憶體 ${(totalmem() / 1024 ** 3).toFixed(1)} GiB；平台 ${platform()}`,
    );

    const server = httpServer(app!);
    const auth = `Bearer ${seeded.token}`;
    const call = (path: string) => async () =>
      (await request(server).get(path).set('Authorization', auth)).status;

    const measurements = [
      await measureEndpoint(
        'GET /api/ledgers/:id/statistics（2026 曆年）',
        call(`/api/ledgers/${seeded.ledgerId}/statistics?from=${PERF_FROM}&to=${PERF_TO}`),
      ),
      await measureEndpoint(
        'GET /api/ledgers/:id/statistics/trend（12 個月）',
        call(
          `/api/ledgers/${seeded.ledgerId}/statistics/trend?endMonth=${PERF_END_MONTH}&months=12`,
        ),
      ),
      await measureEndpoint(
        'GET /api/accounts/balance-trend（12 個月，多年歷史）',
        call(`/api/accounts/balance-trend?endMonth=${PERF_END_MONTH}&months=12`),
      ),
    ];

    await logSlowEndpointPlans(prisma, seeded.ledgerId, seeded.userId, measurements);

    for (const measurement of measurements) {
      expect(measurement.p95).toBeLessThan(500);
    }
  }, 300_000);
});
