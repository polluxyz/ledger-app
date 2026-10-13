import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  DebtEntry,
  Paginated,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/** 3g SC-G1、G2：用明哥與房東的往來紀錄驗證歷史分界、個人餘額過濾與切頁。 */
describe('Debt history sections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(async () => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const date = (day: number) => `2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`;

  async function postEntry(
    who: Person,
    body: CreateDebtEntryRequest,
  ): Promise<CreateDebtEntryResponse> {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as CreateDebtEntryResponse;
  }

  async function entries(
    who: Person,
    counterpartyId: string,
    query: Record<string, string | number> = {},
  ): Promise<Paginated<DebtEntry>> {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return res.body as Paginated<DebtEntry>;
  }

  it('SC-G1、G2：切出最近一次歸零前的歷史並在篩選後分頁', async () => {
    const me = await person(app, 'history-owner@example.com', '本人');
    const mingLend = await postEntry(me, {
      counterparty: { name: '明哥' },
      kind: 'LEND',
      amount: 30000,
      date: date(1),
      record: null,
    });
    const mingId = mingLend.counterparty.id;
    await postEntry(me, {
      counterparty: { id: mingId },
      kind: 'REPAYMENT',
      amount: 30000,
      date: date(5),
      record: null,
    });
    await postEntry(me, {
      counterparty: { id: mingId },
      kind: 'LEND',
      amount: 50000,
      date: date(10),
      record: null,
    });

    const landlordLend = await postEntry(me, {
      counterparty: { name: '房東' },
      kind: 'LEND',
      amount: 9300,
      date: date(2),
      record: null,
    });
    await postEntry(me, {
      counterparty: { id: landlordLend.counterparty.id },
      kind: 'REPAYMENT',
      amount: 9000,
      date: date(6),
      record: null,
      settle: true,
    });

    const outstanding = await entries(me, mingId, { section: 'outstanding' });
    expect(
      outstanding.items.map(({ date: entryDate, balanceAfter }) => [
        entryDate.slice(0, 10),
        balanceAfter,
      ]),
    ).toEqual([['2026-03-10', 50000]]);
    expect(outstanding.total).toBe(1);

    const history = await entries(me, mingId, { section: 'history' });
    expect(
      history.items.map(({ date: entryDate, balanceAfter }) => [
        entryDate.slice(0, 10),
        balanceAfter,
      ]),
    ).toEqual([
      ['2026-03-05', 0],
      ['2026-03-01', 30000],
    ]);
    expect(history.total).toBe(2);

    const secondHistoryPage = await entries(me, mingId, {
      section: 'history',
      limit: 1,
      page: 2,
    });
    expect(secondHistoryPage.total).toBe(2);
    expect(secondHistoryPage.items.map(({ date: entryDate }) => entryDate.slice(0, 10))).toEqual([
      '2026-03-01',
    ]);

    const all = await entries(me, mingId);
    expect(all.total).toBe(3);
    expect(
      all.items.map(({ date: entryDate, balanceAfter }) => [entryDate.slice(0, 10), balanceAfter]),
    ).toEqual([
      ['2026-03-10', 50000],
      ['2026-03-05', 0],
      ['2026-03-01', 30000],
    ]);

    await request(server())
      .get(`/api/counterparties/${mingId}/entries`)
      .query({ section: 'foo' })
      .set(auth(me.token))
      .expect(400);

    const personal = await request(server())
      .get('/api/counterparties')
      .query({ personalNonZero: 'true', limit: 100 })
      .set(auth(me.token))
      .expect(200);
    const personalPage = personal.body as Paginated<Counterparty>;
    expect(personalPage.items.map(({ id }) => id)).toEqual([mingId]);
    expect(personalPage.total).toBe(1);

    const filteredPersonal = await request(server())
      .get('/api/counterparties')
      .query({ personalNonZero: 'true', q: '明哥', limit: 1, page: 1 })
      .set(auth(me.token))
      .expect(200);
    expect((filteredPersonal.body as Paginated<Counterparty>).items.map(({ id }) => id)).toEqual([
      mingId,
    ]);

    const allWithHistory = await request(server())
      .get('/api/counterparties')
      .query({ hasHistory: 'true', limit: 100 })
      .set(auth(me.token))
      .expect(200);
    const historyCounterparties = allWithHistory.body as Paginated<Counterparty>;
    expect(historyCounterparties.total).toBe(2);
    expect(historyCounterparties.items.map(({ id }) => id).sort()).toEqual(
      [mingId, landlordLend.counterparty.id].sort(),
    );

    const historyPage = await request(server())
      .get('/api/counterparties')
      .query({ hasHistory: 'true', limit: 1, page: 2 })
      .set(auth(me.token))
      .expect(200);
    const counterpartiesWithHistory = historyPage.body as Paginated<Counterparty>;
    expect(counterpartiesWithHistory.total).toBe(2);
    expect(counterpartiesWithHistory.items.map(({ id }) => id)).toEqual([
      landlordLend.counterparty.id,
    ]);
  });
});
