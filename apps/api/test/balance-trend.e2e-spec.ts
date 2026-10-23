import type { INestApplication } from '@nestjs/common';
import type { Account, BalanceTrend, Category, Transaction } from '@ledger/shared';
import request from 'supertest';
import { AccountsService } from '../src/accounts/accounts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';
import { createStatisticsExamples, createStatisticsTransaction } from './statistics-fixtures';

/**
 * 資產趨勢的 HTTP 驗收：共用 spec §1 種子核對帳戶頁、用真實退出流程驗證範圍，
 * 另以歷史交易與台灣月底資料驗證回算。只有超大金額案例注入聚合結果，避免灌入數百萬筆交易。
 */
describe('Balance trend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => httpServer(app);

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  function query(
    who: Person,
    input: Record<string, string | number | undefined> = { endMonth: '2026-10' },
  ) {
    return request(server()).get('/api/accounts/balance-trend').set(auth(who.token)).query(input);
  }

  async function trend(who: Person, months = 12): Promise<BalanceTrend> {
    return (await query(who, { endMonth: '2026-10', months }).expect(200)).body as BalanceTrend;
  }

  const totals = (body: BalanceTrend) => body.months.map((point) => point.total);

  it('SC-R16 matches the spec examples and the account page, defaulting to 12 months', async () => {
    const s = await createStatisticsExamples(app, prisma);
    const started = performance.now();
    const body = (await query(s.me).expect(200)).body as BalanceTrend;
    const elapsed = performance.now() - started;
    console.info(`Balance trend 12-month HTTP query: ${elapsed.toFixed(2)}ms`);
    expect(body.months.map((point) => point.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(totals(body)).toEqual([...Array<number>(11).fill(1000000), 5819000]);
    const accounts = await listAccounts(app, s.me.token);
    expect(body.months.at(-1)!.total).toBe(
      accounts.reduce((total, account) => total + account.balance, 0),
    );
  });

  it('SC-R17 includes temporary accounts but excludes deleted, future and other users’ transactions', async () => {
    const s = await createStatisticsExamples(app, prisma);
    // 小美替我記帳，付款人是我而未指定帳戶，必須由後端放進我的臨時帳戶。
    const paid = await request(server())
      .post(`/api/ledgers/${s.homeLedgerId}/transactions`)
      .set(auth(s.mei.token))
      .send({
        type: 'EXPENSE',
        amount: 600,
        date: '2026-10-20T12:00:00+08:00',
        categoryId: s.categories.dinner,
        payerPersonId: s.mePersonId,
      })
      .expect(201);
    const temporary = (await listAccounts(app, s.me.token)).find((account) => account.isTemporary)!;
    expect(temporary.balance).toBe(-600);
    const stored = await prisma.transaction.findUniqueOrThrow({
      where: { id: (paid.body as Transaction).id },
    });
    expect(stored.accountId).toBe(temporary.id);
    expect(totals(await trend(s.me)).at(-1)).toBe(5818400);

    await createStatisticsTransaction(prisma, {
      ledgerId: s.dailyLedgerId,
      creatorId: s.me.userId,
      accountId: s.me.cashId,
      type: 'INCOME',
      amount: 999999,
      date: '2026-11-01T00:10:00+08:00',
    });
    const deleted = await request(server())
      .post(`/api/ledgers/${s.dailyLedgerId}/transactions`)
      .set(auth(s.me.token))
      .send({
        type: 'EXPENSE',
        amount: 321,
        date: '2026-10-20T12:00:00+08:00',
        categoryId: s.categories.lunch,
        accountId: s.me.cashId,
      })
      .expect(201);
    await request(server())
      .delete(`/api/ledgers/${s.dailyLedgerId}/transactions/${(deleted.body as Transaction).id}`)
      .set(auth(s.me.token))
      .expect(204);
    await request(server())
      .post('/api/accounts')
      .set(auth(s.mei.token))
      .send({ name: '別人的存款', initialBalance: 2000000000 })
      .expect(201);
    await createStatisticsTransaction(prisma, {
      ledgerId: s.homeLedgerId,
      creatorId: s.mei.userId,
      accountId: s.mei.cashId,
      type: 'INCOME',
      amount: 777777,
    });
    expect(totals(await trend(s.me))).toEqual([...Array<number>(11).fill(1000000), 5818400]);
  });

  it('SC-R17 removes the account impact of a shared ledger after a real leave request', async () => {
    const me = await person(app, 'leaver@example.com', '離開的人');
    const owner = await person(app, 'owner@example.com', '擁有者');
    const ledgerId = await createSharedLedger(app, owner.token, '退出範圍');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email: me.email, role: 'EDITOR' })
      .expect(201);
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(me.token))
      .query({ type: 'EXPENSE' })
      .expect(200);
    const expense = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(me.token))
      .send({
        type: 'EXPENSE',
        amount: 1100,
        date: '2026-10-15T12:00:00+08:00',
        categoryId: (categories.body as Category[])[0]!.id,
        accountId: me.cashId,
      })
      .expect(201);
    expect(totals(await trend(me)).at(-1)).toBe(-1100);
    await request(server())
      .post(`/api/ledgers/${ledgerId}/leave`)
      .set(auth(me.token))
      .send({ targetLedgerId: null, excludedItemIds: [(expense.body as Transaction).id] })
      .expect(204);
    expect(totals(await trend(me))).toEqual(Array<number>(12).fill(0));
    expect(
      (await listAccounts(app, me.token)).find((account) => account.id === me.cashId)!.balance,
    ).toBe(0);
  });

  it('SC-R29 includes a negative initial balance throughout even when the account was created mid-period', async () => {
    const me = await person(app, 'negative@example.com', '信用卡');
    await prisma.account.create({
      data: {
        userId: me.userId,
        name: '負餘額',
        initialBalance: -12000,
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
    });
    expect(totals(await trend(me))).toEqual(Array<number>(12).fill(-12000));
  });

  it('SC-R29 shifts every month when an unused account is added and deleted', async () => {
    const me = await person(app, 'shift@example.com', '平移');
    const before = totals(await trend(me));
    const created = await request(server())
      .post('/api/accounts')
      .set(auth(me.token))
      .send({ name: '新增存款', initialBalance: 5000000 })
      .expect(201);
    expect(totals(await trend(me))).toEqual(before.map((total) => total + 5000000));
    await request(server())
      .delete(`/api/accounts/${(created.body as Account).id}`)
      .set(auth(me.token))
      .expect(204);
    expect(totals(await trend(me))).toEqual(before);
  });

  it('SC-R29 includes borrowing, lending, collection, repayment and transfers before the first month', async () => {
    const me = await person(app, 'history@example.com', '歷史');
    const savings = await prisma.account.create({ data: { userId: me.userId, name: '儲蓄' } });
    const base = {
      ledgerId: me.ledgerId,
      creatorId: me.userId,
      accountId: me.cashId,
      date: '2020-01-01T00:00:00+08:00',
    };
    for (const [type, amount] of [
      ['BORROW', 3000],
      ['LEND', 1000],
      ['COLLECT', 400],
      ['REPAY', 200],
    ] as const) {
      await createStatisticsTransaction(prisma, { ...base, type, amount });
    }
    await createStatisticsTransaction(prisma, {
      ...base,
      type: 'TRANSFER',
      amount: 700,
      toAccountId: savings.id,
    });
    expect(totals(await trend(me))).toEqual(Array<number>(12).fill(2200));
    // 顯示期間內再轉一次，兩邊都是我的帳戶，總額仍不變。
    await createStatisticsTransaction(prisma, {
      ...base,
      type: 'TRANSFER',
      amount: 300,
      toAccountId: savings.id,
      date: '2026-04-01T00:00:00+08:00',
    });
    expect(totals(await trend(me))).toEqual(Array<number>(12).fill(2200));
    const accounts = await listAccounts(app, me.token);
    expect(accounts.find((account) => account.id === me.cashId)!.balance).toBe(1200);
    expect(accounts.find((account) => account.id === savings.id)!.balance).toBe(1000);
  });

  it('SC-R29 forgiving a debt does not change any account balance', async () => {
    const me = await person(app, 'forgive@example.com', '免除');
    const lent = await request(server())
      .post('/api/debt-entries')
      .set(auth(me.token))
      .send({
        counterparty: { name: '阿德' },
        kind: 'LEND',
        amount: 50000,
        date: '2026-10-15T12:00:00+08:00',
        record: { ledgerId: me.ledgerId, accountId: me.cashId },
      })
      .expect(201);
    const before = await trend(me);
    expect(totals(before).at(-1)).toBe(-50000);
    const cpId = (lent.body as { counterparty: { id: string } }).counterparty.id;
    await request(server())
      .post(`/api/counterparties/${cpId}/forgive`)
      .set(auth(me.token))
      .send({ ledgerId: me.ledgerId })
      .expect(201);
    expect(await trend(me)).toEqual(before);
  });

  it('SC-R29 returns all requested zero points when there are no accounts', async () => {
    const me = await person(app, 'empty@example.com', '空帳戶');
    await prisma.account.deleteMany({ where: { userId: me.userId } });
    const body = await trend(me, 24);
    expect(body.months).toHaveLength(24);
    expect(body.months[0]!.month).toBe('2024-11');
    expect(totals(body)).toEqual(Array<number>(24).fill(0));
  });

  it('includes October 31 at 23:30 Taipei but excludes November 1 at 00:10', async () => {
    const me = await person(app, 'boundary@example.com', '月底');
    const base = {
      ledgerId: me.ledgerId,
      creatorId: me.userId,
      accountId: me.cashId,
      type: 'INCOME' as const,
    };
    await createStatisticsTransaction(prisma, {
      ...base,
      amount: 111,
      date: '2026-10-31T23:30:00+08:00',
    });
    await createStatisticsTransaction(prisma, {
      ...base,
      amount: 222,
      date: '2026-11-01T00:10:00+08:00',
    });
    expect(totals(await trend(me, 1))).toEqual([111]);
    const november = (await query(me, { endMonth: '2026-11', months: 2 }).expect(200))
      .body as BalanceTrend;
    expect(totals(november)).toEqual([111, 333]);
  });

  it('SC-R29 returns a standard error when safe account balances overflow their combined total', async () => {
    const me = await person(app, 'overflow@example.com', '大金額');
    // int4 單筆金額要累積數百萬筆才溢位；注入各自安全的餘額，HTTP 層仍走真正的交易與錯誤 filter。
    jest.spyOn(app.get(AccountsService), 'calculateBalances').mockResolvedValue({
      balances: new Map([
        ['first', Number.MAX_SAFE_INTEGER],
        ['second', 1],
        ['third', -1],
      ]),
      used: new Set(),
    });
    const response = await query(me).expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Unable to calculate account balances.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|Prisma|stack|MAX_SAFE_INTEGER/);
  });

  it.each([
    {},
    { endMonth: '2026-1' },
    { endMonth: '2026-13' },
    { endMonth: '0000-01' },
    { endMonth: '0001-01' },
    { endMonth: '2026-10', months: 0 },
    { endMonth: '2026-10', months: 25 },
    { endMonth: '2026-10', months: 1.5 },
    { endMonth: '2026-10', months: 'abc' },
  ])('returns 400 for invalid query %j', async (input) => {
    const me = await person(app, 'invalid@example.com', '無效參數');
    await query(me, input).expect(400);
  });

  it.each(['userId', 'ledgerId'])(
    'rejects an attempted scope override through %s',
    async (field) => {
      const me = await person(app, 'scope@example.com', '範圍');
      await query(me, { endMonth: '2026-10', [field]: me.userId }).expect(400);
    },
  );
});
