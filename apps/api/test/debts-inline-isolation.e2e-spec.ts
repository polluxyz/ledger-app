import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  CreateSettlementRequest,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 3g 的授權與資料隔離（spec `phase-3g-debts-inline.md` SC-G7）。協調者在實作前寫好，先看到紅燈。
 *
 * 新增的查詢參數與端點只能縮小範圍，不能讓人讀到原本讀不到的東西：
 * - 往來紀錄：別人的對象帶 `section` 一律 404；`personalNonZero`、`hasHistory` 只在自己的對象裡篩。
 * - 結清清單 `GET /ledgers/{id}/settlements`：從沒加入過的人 404；已退出的人只看到自己是任一方
 *   的結清，分頁也放寬不了；退出的人改或撤銷結清一律被擋，資料不變。
 * - `GET /ledger-groups?hasSettlements=true`：不帶出我沒參與過的帳本；已退出的帳本只算跟我有關的。
 *
 * 場景：Alice（OWNER）建共享帳本「花蓮三日」，Bob、Carol 是 EDITOR。Eve 不在帳本裡，有一本自己的
 * 共享帳本。帳本裡記兩筆結清：Bob → Carol、Bob → Alice。退出的是 Carol。
 */
describe('Debts inline isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-13T12:00:00.000Z';
  const LATER = '2026-10-14T12:00:00.000Z';

  async function postEntry(who: Person, body: CreateDebtEntryRequest) {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as CreateDebtEntryResponse;
  }

  /** 借出後全額還清：這個對象有一段已還清的紀錄、個人往來餘額為 0。 */
  async function settledCounterparty(who: Person, name: string): Promise<Counterparty> {
    const lent = await postEntry(who, {
      counterparty: { name },
      kind: 'LEND',
      amount: 9300,
      date: DAY,
      record: null,
    });
    await postEntry(who, {
      counterparty: { id: lent.counterparty.id },
      kind: 'REPAYMENT',
      amount: 9300,
      date: LATER,
      record: null,
    });
    return lent.counterparty;
  }

  /** 只借出、沒還：個人往來餘額不是 0、沒有歷史。 */
  async function owingCounterparty(who: Person, name: string): Promise<Counterparty> {
    const lent = await postEntry(who, {
      counterparty: { name },
      kind: 'LEND',
      amount: 50000,
      date: DAY,
      record: null,
    });
    return lent.counterparty;
  }

  async function counterpartyIds(who: Person, query: Record<string, string>): Promise<string[]> {
    const res = await request(server())
      .get('/api/counterparties')
      .query({ limit: 100, ...query })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<Counterparty>).items.map((c) => c.id);
  }

  describe('往來紀錄的新參數', () => {
    it('別人的對象帶 section 一律 404', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const bobs = await settledCounterparty(bob, '房東');

      // 對照組：本人帶 section 讀得到，證明 404 不是因為參數不存在。
      await request(server())
        .get(`/api/counterparties/${bobs.id}/entries`)
        .query({ section: 'history' })
        .set(auth(bob.token))
        .expect(200);

      for (const section of ['outstanding', 'history']) {
        await request(server())
          .get(`/api/counterparties/${bobs.id}/entries`)
          .query({ section })
          .set(auth(alice.token))
          .expect(404);
      }
    });

    it('personalNonZero、hasHistory 只在自己的對象裡篩', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const aliceSettled = await settledCounterparty(alice, '房東');
      const aliceOwing = await owingCounterparty(alice, '明哥');
      const bobSettled = await settledCounterparty(bob, '房東');
      const bobOwing = await owingCounterparty(bob, '明哥');

      expect(await counterpartyIds(alice, { personalNonZero: 'true' })).toEqual([aliceOwing.id]);
      expect(await counterpartyIds(alice, { hasHistory: 'true' })).toEqual([aliceSettled.id]);

      const aliceAll = [
        ...(await counterpartyIds(alice, { personalNonZero: 'true' })),
        ...(await counterpartyIds(alice, { hasHistory: 'true' })),
      ];
      expect(aliceAll).not.toContain(bobSettled.id);
      expect(aliceAll).not.toContain(bobOwing.id);
    });
  });

  interface LedgerScene {
    alice: Person;
    bob: Person;
    carol: Person;
    eve: Person;
    ledgerId: string;
    eveLedgerId: string;
    bobToCarol: Transaction;
    bobToAlice: Transaction;
  }

  async function addMember(owner: Person, ledgerId: string, email: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email, role: 'EDITOR' })
      .expect(201);
  }

  async function listPeople(who: Person, ledgerId: string): Promise<LedgerPerson[]> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerPerson[];
  }

  async function postSettlement(who: Person, ledgerId: string, body: CreateSettlementRequest) {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as Transaction;
  }

  async function ledgerScene(): Promise<LedgerScene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await addMember(alice, ledgerId, bob.email);
    await addMember(alice, ledgerId, carol.email);
    const eveLedgerId = await createSharedLedger(app, eve.token, 'Eve 的帳本');

    const people = await listPeople(alice, ledgerId);
    const idOf = (name: string) => people.find((p) => p.name === name)!.id;

    const bobToCarol = await postSettlement(bob, ledgerId, {
      fromPersonId: idOf('Bob'),
      toPersonId: idOf('Carol'),
      amount: 10000,
      date: DAY,
      fromAccountId: bob.cashId,
    });
    const bobToAlice = await postSettlement(bob, ledgerId, {
      fromPersonId: idOf('Bob'),
      toPersonId: idOf('Alice'),
      amount: 20000,
      date: LATER,
      fromAccountId: bob.cashId,
    });
    return { alice, bob, carol, eve, ledgerId, eveLedgerId, bobToCarol, bobToAlice };
  }

  async function leave(who: Person, ledgerId: string): Promise<void> {
    await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${who.userId}`)
      .set(auth(who.token))
      .expect(204);
  }

  async function settlementsAs(
    who: Person,
    ledgerId: string,
    query: Record<string, number> = {},
  ): Promise<Paginated<Transaction>> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/settlements`)
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return res.body as Paginated<Transaction>;
  }

  async function groupsWithSettlements(who: Person): Promise<LedgerGroup[]> {
    const res = await request(server())
      .get('/api/ledger-groups')
      .query({ hasSettlements: 'true' })
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerGroup[];
  }

  describe('結清清單 GET /ledgers/{id}/settlements', () => {
    it('現任成員看到全部結清，新到舊', async () => {
      const s = await ledgerScene();
      const page = await settlementsAs(s.carol, s.ledgerId);
      expect(page.items.map((t) => t.id)).toEqual([s.bobToAlice.id, s.bobToCarol.id]);
      expect(page.total).toBe(2);
    });

    it('從沒加入過的人、我沒參與過的帳本都是 404', async () => {
      const s = await ledgerScene();
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/settlements`)
        .set(auth(s.eve.token))
        .expect(404);
      await request(server())
        .get(`/api/ledgers/${s.eveLedgerId}/settlements`)
        .set(auth(s.alice.token))
        .expect(404);
    });

    it('退出後只回我是任一方的結清，分頁放寬不了', async () => {
      const s = await ledgerScene();
      await leave(s.carol, s.ledgerId);

      const all = await settlementsAs(s.carol, s.ledgerId, { limit: 100 });
      expect(all.items.map((t) => t.id)).toEqual([s.bobToCarol.id]);
      expect(all.total).toBe(1);

      const seen: string[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const paged = await settlementsAs(s.carol, s.ledgerId, { limit: 1, page });
        expect(paged.total).toBe(1);
        seen.push(...paged.items.map((t) => t.id));
      }
      expect(seen).toEqual([s.bobToCarol.id]);
    });

    it('退出後改或撤銷結清一律被擋，資料不變', async () => {
      const s = await ledgerScene();
      await leave(s.carol, s.ledgerId);
      const before = await prisma.transaction.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, amount: true, deletedAt: true },
      });

      for (const settlement of [s.bobToCarol, s.bobToAlice]) {
        const path = `/api/ledgers/${s.ledgerId}/settlements/${settlement.id}`;
        const patch = await request(server())
          .patch(path)
          .set(auth(s.carol.token))
          .send({ amount: 1 });
        expect([404, 409]).toContain(patch.status);
        const del = await request(server()).delete(path).set(auth(s.carol.token));
        expect([404, 409]).toContain(del.status);
      }

      const after = await prisma.transaction.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, amount: true, deletedAt: true },
      });
      expect(after).toEqual(before);
    });
  });

  describe('GET /ledger-groups?hasSettlements=true', () => {
    it('不帶出我沒參與過的帳本', async () => {
      const s = await ledgerScene();
      const eveGroups = await groupsWithSettlements(s.eve);
      expect(eveGroups.map((g) => g.ledger.id)).not.toContain(s.ledgerId);
    });

    it('現任成員算全部；已退出只算跟我有關的', async () => {
      const s = await ledgerScene();
      const aliceGroup = (await groupsWithSettlements(s.alice)).find(
        (g) => g.ledger.id === s.ledgerId,
      );
      expect(aliceGroup?.settlementCount).toBe(2);

      await leave(s.carol, s.ledgerId);
      const carolGroup = (await groupsWithSettlements(s.carol)).find(
        (g) => g.ledger.id === s.ledgerId,
      );
      expect(carolGroup?.ledger.left).toBe(true);
      expect(carolGroup?.settlementCount).toBe(1);
    });
  });
});
