import { INestApplication } from '@nestjs/common';
import type { Debt, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  firstAccountId,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 借還帳的授權與資料隔離（spec §3.5）。
 *
 * ⚠️ 協調者先寫的驗收門檻（SEC-10），worker 不准修改。
 *
 * - SC-D10：把借還交易記進帳本時，帳本權限的判斷與一般交易端點**完全一致**。每一組都把
 *   同樣的情境各打一次債務端點與交易端點，比對兩邊的狀態碼，並確認債務端點失敗時沒有
 *   留下半筆債務。
 * - SC-D12：共享帳本的其他成員看得到借還交易，但 `debtId` 是 `null`，也讀不到、改不到那筆
 *   債務。
 */
describe('Debts isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const DAY = '2026-09-24T12:00:00.000Z';

  interface Person {
    token: string;
    userId: string;
    ledgerId: string;
    cashId: string;
  }

  async function person(email: string, name: string): Promise<Person> {
    const user = await registerAndLogin(app, email, name);
    return {
      ...user,
      ledgerId: await firstLedgerId(app, user.token),
      cashId: await firstAccountId(app, user.token),
    };
  }

  async function addMember(owner: Person, ledgerId: string, email: string, role: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email, role })
      .expect(201);
  }

  /** 同一個「記進哪本帳本、用哪個帳戶」，分別走債務端點與交易端點。 */
  async function bothPaths(who: Person, ledgerId: string, accountId: string) {
    const viaDebt = await request(server()).post('/api/debts').set(auth(who.token)).send({
      direction: 'LENT',
      counterpartyName: '小明',
      principal: 100,
      date: DAY,
      record: { ledgerId, accountId },
    });

    // 交易端點需要一個該帳本的支出分類；拿不到（非成員）就隨便給一個 uuid，反正會先被擋。
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token));
    const categoryId =
      categories.status === 200
        ? (categories.body as Array<{ id: string }>)[0]!.id
        : '00000000-0000-4000-8000-000000000000';
    const viaTransaction = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({ type: 'EXPENSE', amount: 100, date: DAY, accountId, categoryId });

    return { viaDebt, viaTransaction };
  }

  describe('SC-D10: recording into a ledger follows the same rules as ordinary transactions', () => {
    it('a non-member gets 404 on both paths, and no debt is left behind', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const carol = await person('carol@example.com', 'Carol');
      const shared = await createSharedLedger(app, bob.token);

      const { viaDebt, viaTransaction } = await bothPaths(carol, shared, carol.cashId);
      expect(viaTransaction.status).toBe(404);
      expect(viaDebt.status).toBe(404);
      expect(await prisma.debt.count()).toBe(0);
    });

    it('a VIEWER gets 403 on both paths, and no debt is left behind', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const alice = await person('alice@example.com', 'Alice');
      const shared = await createSharedLedger(app, bob.token);
      await addMember(bob, shared, 'alice@example.com', 'VIEWER');

      const { viaDebt, viaTransaction } = await bothPaths(alice, shared, alice.cashId);
      expect(viaTransaction.status).toBe(403);
      expect(viaDebt.status).toBe(403);
      expect(await prisma.debt.count()).toBe(0);
    });

    it("someone else's account gets 404 on both paths", async () => {
      const bob = await person('bob@example.com', 'Bob');
      const alice = await person('alice@example.com', 'Alice');

      const { viaDebt, viaTransaction } = await bothPaths(alice, alice.ledgerId, bob.cashId);
      expect(viaTransaction.status).toBe(404);
      expect(viaDebt.status).toBe(404);
      expect(await prisma.debt.count()).toBe(0);
    });

    it('an archived ledger gets 409 LEDGER_ARCHIVED on both paths', async () => {
      const alice = await person('alice@example.com', 'Alice');
      const created = await request(server())
        .post('/api/ledgers')
        .set(auth(alice.token))
        .send({ name: 'Old' });
      const oldLedger = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/ledgers/${oldLedger}/archive`)
        .set(auth(alice.token))
        .expect(201);

      const { viaDebt, viaTransaction } = await bothPaths(alice, oldLedger, alice.cashId);
      expect(viaTransaction.status).toBe(409);
      expect(viaDebt.status).toBe(409);
      expect((viaDebt.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');
      expect(await prisma.debt.count()).toBe(0);
    });

    it('the same rules apply when a repayment is recorded into another ledger', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const alice = await person('alice@example.com', 'Alice');
      const shared = await createSharedLedger(app, bob.token);
      await addMember(bob, shared, 'alice@example.com', 'VIEWER');

      const debt = await request(server())
        .post('/api/debts')
        .set(auth(alice.token))
        .send({
          direction: 'LENT',
          counterpartyName: '小明',
          principal: 1000,
          date: DAY,
          record: { ledgerId: alice.ledgerId, accountId: alice.cashId },
        });
      expect(debt.status).toBe(201);

      const res = await request(server())
        .post(`/api/debts/${(debt.body as Debt).id}/payments`)
        .set(auth(alice.token))
        .send({ amount: 100, date: DAY, record: { ledgerId: shared, accountId: alice.cashId } });
      expect(res.status).toBe(403);
      expect(await prisma.debtPayment.count()).toBe(0);
    });
  });

  describe('SC-D12: other ledger members see the transaction but not the debt', () => {
    async function setup() {
      const bob = await person('bob@example.com', 'Bob');
      const alice = await person('alice@example.com', 'Alice');
      const shared = await createSharedLedger(app, bob.token, 'Household');
      await addMember(bob, shared, 'alice@example.com', 'EDITOR');

      const created = await request(server())
        .post('/api/debts')
        .set(auth(alice.token))
        .send({
          direction: 'LENT',
          counterpartyName: '小明',
          principal: 5000,
          date: DAY,
          note: '私人備註',
          record: { ledgerId: shared, accountId: alice.cashId },
        });
      expect(created.status).toBe(201);
      return { bob, alice, shared, debt: created.body as Debt };
    }

    it('the owner sees the debt id on the transaction; the other member sees null', async () => {
      const { bob, alice, shared, debt } = await setup();

      const asAlice = await request(server())
        .get(`/api/ledgers/${shared}/transactions`)
        .set(auth(alice.token));
      expect((asAlice.body as Paginated<Transaction>).items[0]).toMatchObject({
        type: 'LEND',
        debtId: debt.id,
      });

      const asBob = await request(server())
        .get(`/api/ledgers/${shared}/transactions`)
        .set(auth(bob.token));
      const seen = (asBob.body as Paginated<Transaction>).items[0]!;
      expect(seen).toMatchObject({ type: 'LEND', amount: 5000, debtId: null, account: null });
      expect(JSON.stringify(asBob.body)).not.toContain('私人備註');
    });

    it('the other member cannot read, list, change, repay, forgive or delete the debt', async () => {
      const { bob, debt } = await setup();
      const asBob = auth(bob.token);

      await request(server()).get(`/api/debts/${debt.id}`).set(asBob).expect(404);
      const list = await request(server()).get('/api/debts').set(asBob);
      expect((list.body as Paginated<Debt>).items).toEqual([]);
      const summary = await request(server()).get('/api/debts/summary').set(asBob);
      expect((summary.body as { items: unknown[] }).items).toEqual([]);

      await request(server())
        .patch(`/api/debts/${debt.id}`)
        .set(asBob)
        .send({ principal: 1 })
        .expect(404);
      await request(server())
        .post(`/api/debts/${debt.id}/payments`)
        .set(asBob)
        .send({ amount: 1, date: DAY })
        .expect(404);
      await request(server()).post(`/api/debts/${debt.id}/forgive`).set(asBob).expect(404);
      await request(server()).delete(`/api/debts/${debt.id}`).set(asBob).expect(404);

      // 帳本擁有者也不能從交易端點繞過去改它。
      await request(server())
        .delete(`/api/ledgers/${(await firstShared(bob)).id}/transactions/${debt.transactionId!}`)
        .set(asBob)
        .expect(409);

      const stored = await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
      expect(stored).toMatchObject({ principal: 5000, deletedAt: null, forgivenAt: null });
    });

    async function firstShared(owner: Person): Promise<{ id: string }> {
      const res = await request(server()).get('/api/ledgers').set(auth(owner.token));
      return (res.body as Array<{ id: string; kind: string }>).find((l) => l.kind === 'SHARED')!;
    }
  });
});
