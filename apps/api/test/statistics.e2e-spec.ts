import type { INestApplication } from '@nestjs/common';
import type { LedgerStatistics, StatisticsPerspective, StatisticsTrend } from '@ledger/shared';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth } from './linking-utils';
import {
  createStatisticsAttributionShapes,
  createStatisticsExamples,
  createStatisticsTransaction,
} from './statistics-fixtures';
import type { StatisticsExamples } from './statistics-fixtures';

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

/** 每份 HTTP 回應都檢查 SC-R27 與決策 262；測試加總用 BigInt，避免測試本身捨入。 */
function expectIdentities(body: LedgerStatistics, perspective: StatisticsPerspective) {
  for (const totals of [body.ledger, body.mine]) {
    expect(totals.income).toBeGreaterThanOrEqual(0);
    expect(totals.expense).toBeGreaterThanOrEqual(0);
    expect(BigInt(totals.net)).toBe(BigInt(totals.income) - BigInt(totals.expense));
  }
  const selected = perspective === 'MINE' ? body.mine : body.ledger;
  for (const [groups, field] of [
    [body.expenseGroups, 'expense'],
    [body.incomeGroups, 'income'],
  ] as const) {
    expect(groups.reduce((sum, group) => sum + BigInt(group.amount), 0n)).toBe(
      BigInt(selected[field]),
    );
    expect(groups.reduce((sum, group) => sum + group.percentageBps, 0)).toBe(
      groups.length ? 10000 : 0,
    );
    for (const group of groups) {
      expect(group.amount).toBeGreaterThan(0);
      expect(Object.keys(group).sort()).toEqual(['amount', 'category', 'kind', 'percentageBps']);
    }
  }
  if (body.people === null) {
    expect(body.mine).toEqual(body.ledger);
  } else {
    for (const field of ['income', 'expense'] as const) {
      expect(body.people.reduce((sum, person) => sum + BigInt(person[field]), 0n)).toBe(
        BigInt(body.ledger[field]),
      );
      expect(
        body.people
          .filter((person) => person.isMe)
          .reduce((sum, person) => sum + BigInt(person[field]), 0n),
      ).toBe(BigInt(body.mine[field]));
      for (const person of body.people) expect(person[field]).toBeGreaterThanOrEqual(0);
    }
  }
}

/** 真實 HTTP → DTO → guard → service → PostgreSQL；內部歷史形態沿用 S1a builder。 */
describe('Statistics endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let examples: StatisticsExamples;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(async () => {
    await resetDb(prisma);
    examples = await createStatisticsExamples(app, prisma);
  });
  afterAll(() => app.close());

  async function statistics(
    ledgerId = examples.homeLedgerId,
    perspective: StatisticsPerspective = 'LEDGER',
    period = PERIOD,
  ) {
    const res = await request(httpServer(app))
      .get(`/api/ledgers/${ledgerId}/statistics`)
      .set(auth(examples.me.token))
      .query({ ...period, perspective })
      .expect(200);
    const body = res.body as LedgerStatistics;
    expectIdentities(body, perspective);
    return body;
  }
  async function trend(
    ledgerId = examples.homeLedgerId,
    perspective: StatisticsPerspective = 'LEDGER',
    endMonth = '2026-10',
    months?: number,
  ) {
    const res = await request(httpServer(app))
      .get(`/api/ledgers/${ledgerId}/statistics/trend`)
      .set(auth(examples.me.token))
      .query({ endMonth, perspective, ...(months === undefined ? {} : { months }) })
      .expect(200);
    const body = res.body as StatisticsTrend;
    for (const month of body.months) {
      expect(month.income).toBeGreaterThanOrEqual(0);
      expect(month.expense).toBeGreaterThanOrEqual(0);
      expect(BigInt(month.net)).toBe(BigInt(month.income) - BigInt(month.expense));
    }
    return body;
  }

  it('SC-R1/R3/R4/R6/R23: reproduces 日常 and 家用, both perspectives and fixed groups', async () => {
    const daily = await statistics(examples.dailyLedgerId);
    expect(daily.ledger).toEqual({ income: 5000000, expense: 70300, net: 4929700 });
    expect(daily.people).toBeNull();
    expect(daily.expenseGroups.map((g) => [g.kind, g.amount])).toEqual([
      ['BAD_DEBT', 50000],
      ['CATEGORY', 12000],
      ['CATEGORY', 8000],
      ['DIFFERENCE', 300],
    ]);
    const home = await statistics();
    expect(home.ledger).toEqual({ income: 20000, expense: 120000, net: -100000 });
    expect(home.mine).toEqual({ income: 20000, expense: 45000, net: -25000 });
    expect(home.expenseGroups.map((g) => [g.category?.name, g.percentageBps])).toEqual([
      ['晚餐', 7500],
      ['日用品', 2500],
    ]);
    expect(home.people?.map((p) => [p.name, p.isMe, p.expense, p.income])).toEqual([
      ['小美', false, 75000, 0],
      ['我', true, 45000, 20000],
    ]);
    const mine = await statistics(examples.homeLedgerId, 'MINE');
    expect(mine.people).toEqual(home.people);
    expect(mine.expenseGroups).toEqual([
      expect.objectContaining({ amount: 45000, percentageBps: 10000 }),
    ]);
    await statistics(examples.dailyLedgerId, 'MINE');
  });

  it('SC-R2: excludes all five non-income/expense types even with categories', async () => {
    const before = await statistics(examples.dailyLedgerId);
    for (const type of ['TRANSFER', 'LEND', 'BORROW', 'COLLECT', 'REPAY'] as const) {
      await createStatisticsTransaction(prisma, {
        ledgerId: examples.dailyLedgerId,
        creatorId: examples.me.userId,
        type,
        amount: 10000,
        categoryId: examples.categories.breakfast,
      });
    }
    expect(await statistics(examples.dailyLedgerId)).toEqual(before);
  });

  it('SC-R5: legacy records without a payer belong to their creator', async () => {
    await createStatisticsTransaction(prisma, {
      ledgerId: examples.homeLedgerId,
      creatorId: examples.mei.userId,
      payerPersonId: null,
      type: 'EXPENSE',
      amount: 1234,
    });
    const body = await statistics();
    expect(body.ledger.expense).toBe(121234);
    expect(body.mine.expense).toBe(45000);
    expect(body.people?.find((p) => p.personId === examples.meiPersonId)?.expense).toBe(76234);
  });

  it('SC-R7: fixed groups reveal only my own debt classifications and never private identifiers', async () => {
    await createStatisticsAttributionShapes(app, prisma, examples);
    const privateNames = ['固定分組私密對象', '3c 付款對象'];
    const counterparties = await prisma.counterparty.findMany({ select: { id: true } });
    const debtEntries = await prisma.debtEntry.findMany({ select: { id: true } });
    const secrets = [
      ...privateNames,
      ...counterparties.map((c) => c.id),
      ...debtEntries.map((e) => e.id),
    ];
    const original = await statistics();
    expect(original.expenseGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'BAD_DEBT', amount: 701 }),
        expect.objectContaining({ kind: 'DIFFERENCE', amount: 703 }),
        expect.objectContaining({ kind: 'UNCATEGORIZED', amount: 1404 }),
      ]),
    );
    expect(original.incomeGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'DEBT_FORGIVEN', amount: 702 }),
        expect.objectContaining({ kind: 'DIFFERENCE', amount: 704 }),
        expect.objectContaining({ kind: 'UNCATEGORIZED', amount: 1406 }),
      ]),
    );
    for (const token of [examples.me.token, examples.mei.token]) {
      for (const path of ['', '/trend']) {
        const res = await request(httpServer(app))
          .get(`/api/ledgers/${examples.homeLedgerId}/statistics${path}`)
          .set(auth(token))
          .query(path ? { endMonth: '2026-10' } : PERIOD)
          .expect(200);
        if (!path) expectIdentities(res.body as LedgerStatistics, 'LEDGER');
        for (const secret of secrets) expect(JSON.stringify(res.body)).not.toContain(secret);
      }
    }
    expect(await statistics()).toEqual(original);
  });

  it('SC-R8: a real leave merges only my share into my personal ledger', async () => {
    const t = await createStatisticsTransaction(prisma, {
      ledgerId: examples.homeLedgerId,
      creatorId: examples.mei.userId,
      payerPersonId: examples.meiPersonId,
      accountId: examples.mei.cashId,
      type: 'EXPENSE',
      amount: 300000,
      categoryId: examples.categories.dinner,
    });
    await prisma.ledgerSplit.create({
      data: {
        transactionId: t.id,
        method: 'AMOUNT',
        shares: {
          create: [
            { personId: examples.meiPersonId, share: 100000, sortOrder: 0 },
            { personId: examples.mePersonId, share: 200000, sortOrder: 1 },
          ],
        },
      },
    });
    await request(httpServer(app))
      .post(`/api/ledgers/${examples.homeLedgerId}/leave`)
      .set(auth(examples.mei.token))
      .send({ targetLedgerId: examples.mei.ledgerId, excludedItemIds: [] })
      .expect(204);
    const res = await request(httpServer(app))
      .get(`/api/ledgers/${examples.mei.ledgerId}/statistics`)
      .set(auth(examples.mei.token))
      .query(PERIOD)
      .expect(200);
    const body = res.body as LedgerStatistics;
    expectIdentities(body, 'LEDGER');
    // 原範例小美的 75000 加新交易自己的 100000，代墊的 200000 不計。
    expect(body.ledger.expense).toBe(175000);
    await statistics();
  });

  it('SC-R9/R10/R12: Taiwan boundaries, soft deletion, full months and zero filling', async () => {
    const shapes = await createStatisticsAttributionShapes(app, prisma, examples);
    const october = await statistics();
    const november = await statistics(examples.homeLedgerId, 'LEDGER', {
      from: '2026-11-01',
      to: '2026-11-01',
    });
    expect(november.ledger.expense).toBe(222);
    const lastDay = await statistics(examples.homeLedgerId, 'LEDGER', {
      from: '2026-10-31',
      to: '2026-10-31',
    });
    expect(lastDay.ledger.expense).toBe(111);
    expect(shapes.cases.lateOctober).toBeDefined();
    for (const perspective of ['LEDGER', 'MINE'] as const) {
      const t = await trend(examples.homeLedgerId, perspective);
      expect(t.months).toHaveLength(12);
      expect(t.months[0]).toEqual({ month: '2025-11', income: 0, expense: 0, net: 0 });
      expect(t.months.at(-1)).toEqual({
        month: '2026-10',
        ...(perspective === 'LEDGER' ? october.ledger : october.mine),
      });
      expect((await trend(examples.homeLedgerId, perspective, '2026-11', 1)).months[0]).toEqual({
        month: '2026-11',
        ...(perspective === 'LEDGER' ? november.ledger : november.mine),
      });
    }
    const before = await statistics();
    await createStatisticsTransaction(prisma, {
      ledgerId: examples.homeLedgerId,
      creatorId: examples.me.userId,
      type: 'INCOME',
      amount: 99999,
      deletedAt: new Date(),
    });
    expect(await statistics()).toEqual(before);
    const empty = await statistics(examples.homeLedgerId, 'LEDGER', {
      from: '2028-02-29',
      to: '2028-02-29',
    });
    expect(empty.ledger).toEqual({ income: 0, expense: 0, net: 0 });
    expect(empty.people).toEqual([]);
    await statistics(examples.homeLedgerId, 'LEDGER', { from: '2028-01-01', to: '2028-12-31' });
    expect((await trend(examples.homeLedgerId, 'LEDGER', '2026-10', 24)).months).toHaveLength(24);
  });

  it('SC-R27/R28: each persisted attribution shape independently crosses HTTP and SQL', async () => {
    const shapes = await createStatisticsAttributionShapes(app, prisma, examples);
    // 每個形態移到獨立曆日，能直接驗證各人的份額，不讓總額巧合相同掩蓋錯誤。
    let day = 1;
    for (const [name, shape] of Object.entries(shapes.cases)) {
      const t = await prisma.transaction.update({
        where: { id: shape.transactionId },
        data: { date: new Date(`2027-01-${String(day).padStart(2, '0')}T12:00:00+08:00`) },
      });
      const date = `2027-01-${String(day++).padStart(2, '0')}`;
      for (const perspective of ['LEDGER', 'MINE'] as const) {
        const body = await statistics(t.ledgerId, perspective, { from: date, to: date });
        const field = t.type === 'INCOME' ? 'income' : 'expense';
        expect({ name, amount: body.ledger[field] }).toEqual({
          name,
          amount: Number(shape.allocations.reduce((sum, a) => sum + a.amount, 0n)),
        });
        const meId =
          t.ledgerId === examples.homeLedgerId ? examples.mePersonId : examples.me.userId;
        expect(body.mine[field]).toBe(
          Number(
            shape.allocations
              .filter((a) => a.personId === meId)
              .reduce((sum, a) => sum + a.amount, 0n),
          ),
        );
        if (body.people)
          expect(body.people.map((p) => [p.personId, BigInt(p[field])]).sort()).toEqual(
            shape.allocations
              .filter((a) => a.amount > 0n)
              .map((a) => [a.personId, a.amount])
              .sort(),
          );
      }
    }
    for (const ledgerId of [examples.dailyLedgerId, examples.homeLedgerId]) {
      for (const perspective of ['LEDGER', 'MINE'] as const) {
        const body = await statistics(ledgerId, perspective, {
          from: '2027-01-01',
          to: '2027-01-31',
        });
        expect((await trend(ledgerId, perspective, '2027-01', 1)).months[0]).toEqual({
          month: '2027-01',
          ...(perspective === 'LEDGER' ? body.ledger : body.mine),
        });
      }
    }
  });

  it('SC-R23: stable equal remainders and positive tiny groups with zero basis points', async () => {
    const base = {
      ledgerId: examples.dailyLedgerId,
      creatorId: examples.me.userId,
      type: 'EXPENSE' as const,
      date: new Date('2027-03-01T12:00:00+08:00'),
    };
    for (const id of [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]) {
      await prisma.category.create({
        data: { id, ledgerId: examples.dailyLedgerId, type: 'EXPENSE', name: id },
      });
      await createStatisticsTransaction(prisma, { ...base, amount: 1, categoryId: id });
    }
    const period = { from: '2027-03-01', to: '2027-03-01' };
    const equal = await statistics(examples.dailyLedgerId, 'LEDGER', period);
    expect(equal.expenseGroups.map((g) => g.percentageBps)).toEqual([3334, 3333, 3333]);
    expect(await statistics(examples.dailyLedgerId, 'LEDGER', period)).toEqual(equal);
    await createStatisticsTransaction(prisma, { ...base, amount: 1000000000 });
    const tiny = await statistics(examples.dailyLedgerId, 'MINE', period);
    expect(tiny.expenseGroups.filter((g) => g.amount === 1)).toHaveLength(3);
    expect(
      tiny.expenseGroups.filter((g) => g.amount === 1).every((g) => g.percentageBps === 0),
    ).toBe(true);
  });

  it('uses defaults when perspective and month count are omitted', async () => {
    const res = await request(httpServer(app))
      .get(`/api/ledgers/${examples.homeLedgerId}/statistics`)
      .set(auth(examples.me.token))
      .query(PERIOD)
      .expect(200);
    expect(res.body).toEqual(await statistics());
    const t = await request(httpServer(app))
      .get(`/api/ledgers/${examples.homeLedgerId}/statistics/trend`)
      .set(auth(examples.me.token))
      .query({ endMonth: '2026-10' })
      .expect(200);
    expect(t.body).toEqual(await trend());
  });

  const invalidStatistics = [
    { ...PERIOD, perspective: 'OTHER' },
    { ...PERIOD, from: '2026/10/01' },
    { ...PERIOD, from: '2026-02-30' },
    { ...PERIOD, to: '2026-02-30' },
    { from: '2026-10-31', to: '2026-10-01' },
    { from: '2026-01-01', to: '2027-01-02' },
    { to: PERIOD.to },
    { from: PERIOD.from },
  ];
  it.each(invalidStatistics)('SC-R10 rejects statistics query %j', async (query) => {
    await request(httpServer(app))
      .get(`/api/ledgers/${examples.homeLedgerId}/statistics`)
      .set(auth(examples.me.token))
      .query(query)
      .expect(400);
  });
  const invalidTrend = [
    ...[0, 25, 1.5, 'abc'].map((months) => ({ endMonth: '2026-10', months })),
    { endMonth: '2026-10', perspective: 'OTHER' },
    { endMonth: '2026-13' },
    { endMonth: '2026/10' },
    {},
  ];
  it.each(invalidTrend)('rejects trend query %j', async (query) => {
    await request(httpServer(app))
      .get(`/api/ledgers/${examples.homeLedgerId}/statistics/trend`)
      .set(auth(examples.me.token))
      .query(query)
      .expect(400);
  });
});
