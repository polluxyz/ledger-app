import { INestApplication } from '@nestjs/common';
import type {
  BalanceTrend,
  Category,
  LedgerStatistics,
  StatisticsGroup,
  StatisticsTrend,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, linkPair, person, proposals, type Person } from './linking-utils';

/**
 * 2j 的授權與資料隔離（spec `phase-2j-stats.md` SC-R11、SC-R7）。協調者在實作前寫好，先看到紅燈。
 *
 * - SC-R11：收支統計與收支趨勢兩個端點各自測「不是成員 404、已退出 404、未登入 401、
 *   檢視者 200、封存 200」。資產趨勢測「未登入 401、別人的帳戶與交易不影響結果」。
 * - SC-R7：小美在「家用」的呆帳、結清差額（支出與收入兩個方向）、債務免除，我看到的全是
 *   「未分類」，小美看到對應的固定分組；回應裡找不到對象名稱與往來 id；兩人交替查詢互不影響。
 *
 * 防假綠：路由還不存在時，「不是成員 → 404」會直接通過。所以每條 404 都配一條正向對照：
 * 同一本帳本、同一組參數，成員查得到 200。實作前正向對照會讓整個測試紅。
 * 「已退出」用真的退出 API 做出來，不直接改資料庫。
 *
 * 全部走 HTTP，只在收集「不該外露的 id」時直接讀資料庫。
 */
describe('Statistics — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  /** 台灣時間 2026-10-18 中午，離月界很遠，這裡不測日期邊界。 */
  const DAY = '2026-10-18T04:00:00.000Z';
  const PERIOD = { from: '2026-10-01', to: '2026-10-31' };
  const TREND = { endMonth: '2026-10', months: 12 };

  interface Scene {
    owner: Person;
    mei: Person;
    viewer: Person;
    leaver: Person;
    eve: Person;
    ledgerId: string;
  }

  /** Owner 擁有共享帳本「家用」；小美、Lee 是 EDITOR，Val 是 VIEWER；Eve 不在帳本裡。 */
  async function scene(): Promise<Scene> {
    const owner = await person(app, 'owner@example.com', 'Owner');
    const mei = await person(app, 'mei@example.com', 'Mei');
    const viewer = await person(app, 'val@example.com', 'Val');
    const leaver = await person(app, 'lee@example.com', 'Lee');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const ledgerId = await createSharedLedger(app, owner.token, '家用');
    for (const [who, role] of [
      [mei, 'EDITOR'],
      [viewer, 'VIEWER'],
      [leaver, 'EDITOR'],
    ] as const) {
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(owner.token))
        .send({ email: who.email, role })
        .expect(201);
    }
    return { owner, mei, viewer, leaver, eve, ledgerId };
  }

  function statistics(token: string | null, ledgerId: string) {
    const req = request(server()).get(`/api/ledgers/${ledgerId}/statistics`).query(PERIOD);
    return token === null ? req : req.set(auth(token));
  }

  function trend(token: string | null, ledgerId: string) {
    const req = request(server()).get(`/api/ledgers/${ledgerId}/statistics/trend`).query(TREND);
    return token === null ? req : req.set(auth(token));
  }

  function balanceTrend(token: string | null) {
    const req = request(server()).get('/api/accounts/balance-trend').query(TREND);
    return token === null ? req : req.set(auth(token));
  }

  async function expenseCategory(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  async function expense(who: Person, ledgerId: string, amount: number, accountId = who.cashId) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({
        type: 'EXPENSE',
        amount,
        date: DAY,
        title: '日用品',
        categoryId: await expenseCategory(who, ledgerId),
        accountId,
      })
      .expect(201);
  }

  const ledgerEndpoints = [
    ['GET /ledgers/{id}/statistics', statistics],
    ['GET /ledgers/{id}/statistics/trend', trend],
  ] as const;

  describe.each(ledgerEndpoints)('SC-R11 %s', (_name, call) => {
    it('returns 404 to a non-member, with a member succeeding on the same ledger', async () => {
      const s = await scene();
      await expense(s.owner, s.ledgerId, 12000);

      await call(s.owner.token, s.ledgerId).expect(200);
      const res = await call(s.eve.token, s.ledgerId).expect(404);
      expect(JSON.stringify(res.body)).not.toContain('家用');
    });

    it('returns 404 after the member leaves through the leave API', async () => {
      const s = await scene();
      await call(s.leaver.token, s.ledgerId).expect(200);

      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/leave`)
        .set(auth(s.leaver.token))
        .send({ targetLedgerId: null, excludedItemIds: [] })
        .expect(204);

      await call(s.leaver.token, s.ledgerId).expect(404);
      await call(s.owner.token, s.ledgerId).expect(200);
    });

    it('returns 401 without a token, with the same request succeeding when signed in', async () => {
      const s = await scene();
      await call(null, s.ledgerId).expect(401);
      await call(s.owner.token, s.ledgerId).expect(200);
    });

    it('lets a viewer read, and keeps working after the ledger is archived', async () => {
      const s = await scene();
      await expense(s.owner, s.ledgerId, 12000);
      const before = (await call(s.viewer.token, s.ledgerId).expect(200)).body as unknown;

      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/archive`)
        .set(auth(s.owner.token))
        .expect(201);

      expect((await call(s.viewer.token, s.ledgerId).expect(200)).body).toEqual(before);
      await call(s.owner.token, s.ledgerId).expect(200);
    });
  });

  describe('SC-R11 GET /accounts/balance-trend', () => {
    it('returns 401 without a token, with the same request succeeding when signed in', async () => {
      const s = await scene();
      await balanceTrend(null).expect(401);
      await balanceTrend(s.mei.token).expect(200);
    });

    it('ignores other users’ accounts and transactions but follows my own', async () => {
      const s = await scene();
      const before = (await balanceTrend(s.mei.token).expect(200)).body as BalanceTrend;
      expect(before.months).toHaveLength(12);

      // 別人的帳戶與交易：Eve 開一個有初始餘額的帳戶並記帳；Owner 在共享帳本用自己的現金記帳。
      const eveAccount = await request(server())
        .post('/api/accounts')
        .set(auth(s.eve.token))
        .send({ name: '存款', initialBalance: 777700 })
        .expect(201);
      await expense(s.eve, s.eve.ledgerId, 3300, (eveAccount.body as { id: string }).id);
      await expense(s.owner, s.ledgerId, 12000);
      expect((await balanceTrend(s.mei.token).expect(200)).body).toEqual(before);

      // 正向對照：小美自己的交易要反映出來，否則「永遠回 0」的空殼也會過。
      await expense(s.mei, s.ledgerId, 4500);
      const after = (await balanceTrend(s.mei.token).expect(200)).body as BalanceTrend;
      expect(after.months.at(-1)!.total).toBe(before.months.at(-1)!.total - 4500);
    });
  });

  describe('SC-R7 fixed groups stay private', () => {
    /**
     * 小美在「家用」記下 4 筆沒有分類、背後是她的往來紀錄的交易：
     * - 呆帳：借阿德 $500，全額免除 → 支出 50000。
     * - 結清差額（支出）：借房東 $93，收回 $90 並結清 → 支出 300。
     * - 結清差額（收入）：借阿明 $100，收回 $105 並結清 → 收入 500。
     * - 債務免除：Frank（不在帳本裡）借小美 $200，之後免除，小美接受 → 收入 20000。
     * 借出、借入、收回本身不算收支（決策 227），所以帳本只有上面 4 筆收支。
     */
    async function meiDebts(s: Scene): Promise<{ frank: Person }> {
      const record = { ledgerId: s.ledgerId, accountId: s.mei.cashId };
      const debt = (body: Record<string, unknown>) =>
        request(server())
          .post('/api/debt-entries')
          .set(auth(s.mei.token))
          .send({ date: DAY, record, ...body })
          .expect(201);
      const lend = async (name: string, amount: number) =>
        (
          (await debt({ counterparty: { name }, kind: 'LEND', amount })).body as {
            counterparty: { id: string };
          }
        ).counterparty.id;

      const ade = await lend('阿德', 50000);
      await request(server())
        .post(`/api/counterparties/${ade}/forgive`)
        .set(auth(s.mei.token))
        .send({ ledgerId: s.ledgerId })
        .expect(201);

      const landlord = await lend('房東', 9300);
      await debt({ counterparty: { id: landlord }, kind: 'REPAYMENT', amount: 9000, settle: true });
      const ming = await lend('阿明', 10000);
      await debt({ counterparty: { id: ming }, kind: 'REPAYMENT', amount: 10500, settle: true });

      const frank = await person(app, 'frank@example.com', 'Frank');
      const pair = await linkPair(app, frank, s.mei, '美美', '阿姨');
      await request(server())
        .post('/api/debt-entries')
        .set(auth(frank.token))
        .send({
          date: DAY,
          record: { ledgerId: frank.ledgerId, accountId: frank.cashId },
          counterparty: { id: pair.aCounterpartyId },
          kind: 'LEND',
          amount: 20000,
        })
        .expect(201);
      const loan = (await proposals(app, s.mei, 'incoming')).find(
        (proposal) => proposal.type === 'CREATE' && proposal.entryKind === 'BORROW',
      )!;
      await request(server())
        .post(`/api/debt-proposals/${loan.id}/accept`)
        .set(auth(s.mei.token))
        .send({ record })
        .expect(200);
      await request(server())
        .post(`/api/counterparties/${pair.aCounterpartyId}/forgive`)
        .set(auth(frank.token))
        .send({ ledgerId: frank.ledgerId })
        .expect(201);
      const forgiveness = (await proposals(app, s.mei, 'incoming')).find(
        (proposal) => proposal.type === 'CREATE' && proposal.entryKind === 'FORGIVEN',
      )!;
      await request(server())
        .post(`/api/debt-proposals/${forgiveness.id}/accept`)
        .set(auth(s.mei.token))
        .send({ record: { ledgerId: s.ledgerId } })
        .expect(200);
      return { frank };
    }

    const group = (kind: StatisticsGroup['kind'], amount: number): unknown =>
      expect.objectContaining({ kind, amount, category: null });

    it('shows the owner of the debts their fixed groups and everyone else only “uncategorized”', async () => {
      const s = await scene();
      await meiDebts(s);

      // 正向對照：小美看得到自己的 4 種固定分組。
      const mine = (await statistics(s.mei.token, s.ledgerId).expect(200)).body as LedgerStatistics;
      expect(mine.expenseGroups).toEqual(
        expect.arrayContaining([group('BAD_DEBT', 50000), group('DIFFERENCE', 300)]),
      );
      expect(mine.incomeGroups).toEqual(
        expect.arrayContaining([group('DIFFERENCE', 500), group('DEBT_FORGIVEN', 20000)]),
      );

      // 其他成員（擁有者與檢視者）只看到「未分類」，金額照算。
      for (const other of [s.owner, s.viewer]) {
        const body = (await statistics(other.token, s.ledgerId).expect(200))
          .body as LedgerStatistics;
        expect(body.ledger).toEqual({ income: 20500, expense: 50300, net: -29800 });
        expect(body.expenseGroups).toEqual([
          expect.objectContaining({
            kind: 'UNCATEGORIZED',
            category: null,
            amount: 50300,
            percentageBps: 10000,
          }),
        ]);
        expect(body.incomeGroups).toEqual([
          expect.objectContaining({
            kind: 'UNCATEGORIZED',
            category: null,
            amount: 20500,
            percentageBps: 10000,
          }),
        ]);
      }
    });

    it('leaks no counterparty names or debt ids in any member’s response', async () => {
      const s = await scene();
      await meiDebts(s);

      const counterparties = await prisma.counterparty.findMany({ select: { id: true } });
      const entries = await prisma.debtEntry.findMany({ select: { id: true } });
      const secrets = [
        '阿德',
        '房東',
        '阿明',
        '阿姨',
        '美美',
        ...counterparties.map((c) => c.id),
        ...entries.map((e) => e.id),
      ];
      expect(entries.length).toBeGreaterThan(0);

      for (const who of [s.owner, s.mei, s.viewer]) {
        for (const call of [statistics, trend]) {
          const res = await call(who.token, s.ledgerId).expect(200);
          const text = JSON.stringify(res.body);
          for (const secret of secrets) expect(text).not.toContain(secret);
        }
      }
    });

    it('gives each member the same answer when they query alternately', async () => {
      const s = await scene();
      await meiDebts(s);

      const ownerFirst = (await statistics(s.owner.token, s.ledgerId).expect(200)).body as unknown;
      const meiFirst = (await statistics(s.mei.token, s.ledgerId).expect(200)).body as unknown;
      expect(meiFirst).not.toEqual(ownerFirst);
      for (let round = 0; round < 2; round += 1) {
        expect((await statistics(s.owner.token, s.ledgerId).expect(200)).body).toEqual(ownerFirst);
        expect((await statistics(s.mei.token, s.ledgerId).expect(200)).body).toEqual(meiFirst);
      }
      const trendBody = (await trend(s.owner.token, s.ledgerId).expect(200))
        .body as StatisticsTrend;
      expect(trendBody.months.at(-1)).toMatchObject({ month: '2026-10', expense: 50300 });
    });
  });
});
