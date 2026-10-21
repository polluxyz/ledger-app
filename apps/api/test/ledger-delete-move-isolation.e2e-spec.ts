import { INestApplication } from '@nestjs/common';
import type {
  Category,
  LeaveRequest,
  MarkedTransaction,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, createCounterparty, person, type Person } from './linking-utils';

/**
 * 3l 的授權與資料隔離（spec `phase-3l-move-and-copy.md` SC-N7、SC-N12）。
 * 總控在實作前寫好，先看到紅燈。
 *
 * - 刪除私人帳本時搬走：別人的私人帳本 404；目標是我只能檢視的帳本 403、封存的 409、
 *   不是成員的 404，而且都沒有寫入。搬進共享帳本只動我自己的資料：其他成員的帳戶不變，
 *   看得到搬過去的交易，但看不到我背後的往來（3b 決策 13）。
 * - 標註：不是成員 404；`ledgerId` 跟交易不符 404；已刪除的交易 404；檢視者可以標；
 *   標註只屬於標註的人，別人的回應與標註列表都看不到。
 *
 * 「404」類的斷言在端點還不存在時本來就會過，所以每條都配一個正向對照（同一個場景裡
 * 合法的呼叫成功），整條測試才會在實作前是紅的。
 *
 * 場景：Bob 有私人帳本「旅行基金」，裡面一筆機票訂金（現金 −$5,000）與一筆借給阿德
 * （現金 −$1,000）。Carol 擁有共享帳本「家用」（Bob 是 EDITOR）、「公司聚餐」（Bob 是
 * VIEWER）、「舊帳」（Bob 是 EDITOR，已封存）。Eve 不在任何一本裡。全部走 HTTP，只在斷言
 * 「沒有寫入」時直接讀資料庫。
 */
describe('Ledger delete with moves and transaction marks — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-21T12:00:00.000Z';
  const TRAVEL = '旅行基金';

  interface Scene {
    bob: Person;
    carol: Person;
    eve: Person;
    travelId: string;
    homeId: string;
    viewerLedgerId: string;
    archivedLedgerId: string;
    ticketId: string;
    lendId: string;
  }

  async function expenseCategory(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  async function expense(who: Person, ledgerId: string, title: string, amount: number) {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({
        type: 'EXPENSE',
        amount,
        date: DAY,
        title,
        categoryId: await expenseCategory(who, ledgerId),
        accountId: who.cashId,
      })
      .expect(201);
    return res.body as Transaction;
  }

  async function scene(): Promise<Scene> {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const travel = await request(server())
      .post('/api/ledgers')
      .set(auth(bob.token))
      .send({ name: TRAVEL, kind: 'PERSONAL' })
      .expect(201);
    const travelId = (travel.body as { id: string }).id;
    const homeId = await createSharedLedger(app, carol.token, '家用');
    const viewerLedgerId = await createSharedLedger(app, carol.token, '公司聚餐');
    const archivedLedgerId = await createSharedLedger(app, carol.token, '舊帳');
    for (const [id, role] of [
      [homeId, 'EDITOR'],
      [viewerLedgerId, 'VIEWER'],
      [archivedLedgerId, 'EDITOR'],
    ] as const) {
      await request(server())
        .post(`/api/ledgers/${id}/members`)
        .set(auth(carol.token))
        .send({ email: bob.email, role })
        .expect(201);
    }
    await request(server())
      .post(`/api/ledgers/${archivedLedgerId}/archive`)
      .set(auth(carol.token))
      .expect(201);

    const ticket = await expense(bob, travelId, '機票訂金', 500000);
    const ade = await createCounterparty(app, bob, '阿德');
    await request(server())
      .post('/api/debt-entries')
      .set(auth(bob.token))
      .send({
        counterparty: { id: ade.id },
        kind: 'LEND',
        amount: 100000,
        date: DAY,
        title: '借給阿德',
        record: { ledgerId: travelId, accountId: bob.cashId },
      })
      .expect(201);
    const lend = await prisma.transaction.findFirstOrThrow({
      where: { ledgerId: travelId, type: 'LEND' },
    });
    return {
      bob,
      carol,
      eve,
      travelId,
      homeId,
      viewerLedgerId,
      archivedLedgerId,
      ticketId: ticket.id,
      lendId: lend.id,
    };
  }

  async function markCount(): Promise<number> {
    return prisma.transactionMark.count();
  }

  const deleteWith = (moves: LeaveRequest['moves']): LeaveRequest => ({
    deleteLedger: true,
    moves,
  });

  function preview(who: Person, ledgerId: string, body: LeaveRequest) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/leave-preview`)
      .set(auth(who.token))
      .send(body);
  }

  function execute(who: Person, ledgerId: string, body: LeaveRequest) {
    return request(server()).post(`/api/ledgers/${ledgerId}/leave`).set(auth(who.token)).send(body);
  }

  /** 旅行基金原封不動：帳本還在、兩筆交易還在原帳本。 */
  async function expectUntouched(s: Scene) {
    expect(await prisma.ledger.findUnique({ where: { id: s.travelId } })).not.toBeNull();
    const rows = await prisma.transaction.findMany({
      where: { id: { in: [s.ticketId, s.lendId] } },
      select: { ledgerId: true, deletedAt: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual({ ledgerId: s.travelId, deletedAt: null });
  }

  describe('SC-N7 刪除私人帳本時搬走', () => {
    it('別人的私人帳本：預覽與執行都 404；本人預覽可以', async () => {
      const s = await scene();
      const body = deleteWith([{ targetLedgerId: s.eve.ledgerId, itemIds: [s.ticketId] }]);

      expect((await preview(s.eve, s.travelId, body)).status).toBe(404);
      expect((await execute(s.eve, s.travelId, { ...body, confirm: TRAVEL })).status).toBe(404);
      await expectUntouched(s);

      const own = await preview(s.bob, s.travelId, deleteWith([]));
      expect(own.status).toBe(200);
    });

    it('目標是我只能檢視的帳本：403，什麼都沒寫', async () => {
      const s = await scene();
      const body = deleteWith([{ targetLedgerId: s.viewerLedgerId, itemIds: [s.ticketId] }]);

      expect((await preview(s.bob, s.travelId, body)).status).toBe(403);
      expect((await execute(s.bob, s.travelId, { ...body, confirm: TRAVEL })).status).toBe(403);
      await expectUntouched(s);
    });

    it('目標是封存的帳本：409，什麼都沒寫', async () => {
      const s = await scene();
      const body = deleteWith([{ targetLedgerId: s.archivedLedgerId, itemIds: [s.ticketId] }]);

      expect((await preview(s.bob, s.travelId, body)).status).toBe(409);
      expect((await execute(s.bob, s.travelId, { ...body, confirm: TRAVEL })).status).toBe(409);
      await expectUntouched(s);
    });

    it('目標是我不是成員的帳本：404，不透露帳本存在；搬到自己能記帳的帳本可以預覽', async () => {
      const s = await scene();
      const body = deleteWith([{ targetLedgerId: s.eve.ledgerId, itemIds: [s.ticketId] }]);

      expect((await preview(s.bob, s.travelId, body)).status).toBe(404);
      expect((await execute(s.bob, s.travelId, { ...body, confirm: TRAVEL })).status).toBe(404);
      await expectUntouched(s);

      const ok = await preview(
        s.bob,
        s.travelId,
        deleteWith([{ targetLedgerId: s.homeId, itemIds: [s.ticketId] }]),
      );
      expect(ok.status).toBe(200);
    });

    it('搬進共享帳本只動我自己的資料：其他成員帳戶不變、看得到交易、看不到我背後的往來', async () => {
      const s = await scene();
      const carolBefore = await listAccounts(app, s.carol.token);
      const bobBefore = await listAccounts(app, s.bob.token);

      await execute(s.bob, s.travelId, {
        ...deleteWith([{ targetLedgerId: s.homeId, itemIds: [s.ticketId, s.lendId] }]),
        confirm: TRAVEL,
      }).expect(204);

      expect(await listAccounts(app, s.carol.token)).toEqual(carolBefore);
      expect(await listAccounts(app, s.bob.token)).toEqual(bobBefore);

      const carolList = await request(server())
        .get(`/api/ledgers/${s.homeId}/transactions`)
        .set(auth(s.carol.token))
        .expect(200);
      // 3b 決策 13：其他成員看得到借還交易，看不到背後的往來（spec 決策 214，2026-10-21 更正）。
      const carolItems = (carolList.body as Paginated<Transaction>).items;
      expect(carolItems.map((t) => t.id)).toEqual(expect.arrayContaining([s.ticketId, s.lendId]));
      expect(carolItems.find((t) => t.id === s.lendId)!.debt).toBeNull();

      // 搬過去的交易還是用 Bob 自己的帳戶，沒有改到 Carol 的。
      const moved = await prisma.transaction.findMany({
        where: { id: { in: [s.ticketId, s.lendId] } },
        select: { ledgerId: true, accountId: true },
      });
      for (const row of moved) expect(row).toEqual({ ledgerId: s.homeId, accountId: s.bob.cashId });

      await request(server()).get(`/api/ledgers/${s.travelId}`).set(auth(s.bob.token)).expect(404);
    });
  });

  describe('SC-N12 標註', () => {
    const markPath = (ledgerId: string, transactionId: string) =>
      `/api/ledgers/${ledgerId}/transactions/${transactionId}/mark`;

    async function marked(who: Person): Promise<MarkedTransaction[]> {
      const res = await request(server())
        .get('/api/transactions/marked')
        .set(auth(who.token))
        .expect(200);
      return (res.body as Paginated<MarkedTransaction>).items;
    }

    it('不是成員：標與取消都 404；成員可以標', async () => {
      const s = await scene();
      const taxi = await expense(s.carol, s.homeId, '計程車', 30000);

      expect(
        (await request(server()).put(markPath(s.homeId, taxi.id)).set(auth(s.eve.token))).status,
      ).toBe(404);
      expect(
        (await request(server()).delete(markPath(s.homeId, taxi.id)).set(auth(s.eve.token))).status,
      ).toBe(404);
      expect(await markCount()).toBe(0);

      await request(server()).put(markPath(s.homeId, taxi.id)).set(auth(s.carol.token)).expect(204);
      expect(await marked(s.eve)).toEqual([]);
    });

    it('ledgerId 跟交易不符：404；用正確的帳本可以標', async () => {
      const s = await scene();
      const taxi = await expense(s.carol, s.homeId, '計程車', 30000);

      // Bob 是兩本的成員，但交易不屬於路徑上的帳本。
      expect(
        (await request(server()).put(markPath(s.bob.ledgerId, taxi.id)).set(auth(s.bob.token)))
          .status,
      ).toBe(404);
      expect(
        (await request(server()).put(markPath(s.travelId, taxi.id)).set(auth(s.bob.token))).status,
      ).toBe(404);
      expect(await markCount()).toBe(0);

      await request(server()).put(markPath(s.homeId, taxi.id)).set(auth(s.bob.token)).expect(204);
    });

    it('檢視者可以標；標註只屬於自己，別人的回應與標註列表都看不到', async () => {
      const s = await scene();
      const lunch = await expense(s.carol, s.viewerLedgerId, '午餐', 20000);

      await request(server())
        .put(markPath(s.viewerLedgerId, lunch.id))
        .set(auth(s.bob.token))
        .expect(204);
      // 重複標註也是 204。
      await request(server())
        .put(markPath(s.viewerLedgerId, lunch.id))
        .set(auth(s.bob.token))
        .expect(204);

      const asBob = await request(server())
        .get(`/api/ledgers/${s.viewerLedgerId}/transactions/${lunch.id}`)
        .set(auth(s.bob.token))
        .expect(200);
      expect((asBob.body as Transaction).marked).toBe(true);
      const asCarol = await request(server())
        .get(`/api/ledgers/${s.viewerLedgerId}/transactions/${lunch.id}`)
        .set(auth(s.carol.token))
        .expect(200);
      expect((asCarol.body as Transaction).marked).toBe(false);

      const bobMarked = await marked(s.bob);
      expect(bobMarked.map((t) => [t.id, t.ledger.name])).toEqual([[lunch.id, '公司聚餐']]);
      expect(await marked(s.carol)).toEqual([]);
    });

    it('已刪除的交易：404；沒刪除的可以標', async () => {
      const s = await scene();
      const taxi = await expense(s.carol, s.homeId, '計程車', 30000);
      const bus = await expense(s.carol, s.homeId, '公車', 1500);
      await request(server())
        .delete(`/api/ledgers/${s.homeId}/transactions/${taxi.id}`)
        .set(auth(s.carol.token))
        .expect(204);

      expect(
        (await request(server()).put(markPath(s.homeId, taxi.id)).set(auth(s.bob.token))).status,
      ).toBe(404);
      await request(server()).put(markPath(s.homeId, bus.id)).set(auth(s.bob.token)).expect(204);
    });
  });
});
