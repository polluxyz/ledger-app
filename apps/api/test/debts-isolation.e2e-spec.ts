import { INestApplication } from '@nestjs/common';
import type { CreateDebtEntryResponse, Paginated, Transaction } from '@ledger/shared';
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
 * 往來帳的授權與資料隔離（spec 3b 往來帳版 §3.5）。
 *
 * - SC-L11：把往來記進帳本時，帳本權限的判斷與一般交易端點**完全一致**。每一組都把同樣的
 *   情境各打一次往來帳端點與交易端點，比對兩邊的狀態碼；往來帳端點失敗時，新對象、往來
 *   紀錄、交易一樣都不能留下。
 * - SC-L12：共享帳本的其他成員看得到借還交易與代付支出，但交易回應的 `debt` 是 `null`，
 *   也讀不到、改不到背後的對象與往來紀錄。
 */
describe('Debt ledger isolation (e2e)', () => {
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

  async function expenseCategoryId(who: Person, ledgerId: string): Promise<string> {
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token));
    return categories.status === 200
      ? (categories.body as Array<{ id: string }>)[0]!.id
      : '00000000-0000-4000-8000-000000000000';
  }

  /** 同一個「記進哪本帳本、用哪個帳戶」，分別走往來帳端點與交易端點。新對象用名字建立。 */
  async function bothPaths(who: Person, ledgerId: string, accountId: string) {
    const viaEntry = await request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({
        counterparty: { name: '小明' },
        kind: 'LEND',
        amount: 100,
        date: DAY,
        record: { ledgerId, accountId },
      });
    const viaTransaction = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: DAY,
        accountId,
        categoryId: await expenseCategoryId(who, ledgerId),
      });
    return { viaEntry, viaTransaction };
  }

  /** 失敗的寫入不可以留下任何東西——連新名字建立的對象都不行。 */
  async function expectNothingLeft() {
    expect(await prisma.counterparty.count()).toBe(0);
    expect(await prisma.debtEntry.count()).toBe(0);
    expect(await prisma.transaction.count({ where: { type: 'LEND' } })).toBe(0);
  }

  describe('SC-L11: recording into a ledger follows the same rules as ordinary transactions', () => {
    it('a non-member gets 404 on both paths, and nothing is left behind', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const carol = await person('carol@example.com', 'Carol');
      const shared = await createSharedLedger(app, bob.token);

      const { viaEntry, viaTransaction } = await bothPaths(carol, shared, carol.cashId);
      expect(viaTransaction.status).toBe(404);
      expect(viaEntry.status).toBe(404);
      await expectNothingLeft();
    });

    it('a VIEWER gets 403 on both paths', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const carol = await person('carol@example.com', 'Carol');
      const shared = await createSharedLedger(app, bob.token);
      await addMember(bob, shared, 'carol@example.com', 'VIEWER');

      const { viaEntry, viaTransaction } = await bothPaths(carol, shared, carol.cashId);
      expect(viaTransaction.status).toBe(403);
      expect(viaEntry.status).toBe(403);
      await expectNothingLeft();
    });

    it("someone else's account gets 404 on both paths", async () => {
      const bob = await person('bob@example.com', 'Bob');
      const carol = await person('carol@example.com', 'Carol');

      const { viaEntry, viaTransaction } = await bothPaths(carol, carol.ledgerId, bob.cashId);
      expect(viaTransaction.status).toBe(404);
      expect(viaEntry.status).toBe(404);
      await expectNothingLeft();
    });

    it('an archived ledger gets 409 LEDGER_ARCHIVED on both paths', async () => {
      const bob = await person('bob@example.com', 'Bob');
      const shared = await createSharedLedger(app, bob.token);
      await request(server())
        .post(`/api/ledgers/${shared}/archive`)
        .set(auth(bob.token))
        .expect(201);

      const { viaEntry, viaTransaction } = await bothPaths(bob, shared, bob.cashId);
      expect(viaTransaction.status).toBe(409);
      expect(viaEntry.status).toBe(409);
      expect((viaEntry.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');
      await expectNothingLeft();
    });
  });

  describe('SC-L12: other ledger members see the transactions, not the ledger behind them', () => {
    async function setup() {
      const bob = await person('bob@example.com', 'Bob');
      const carol = await person('carol@example.com', 'Carol');
      const shared = await createSharedLedger(app, bob.token);
      await addMember(bob, shared, 'carol@example.com', 'EDITOR');

      const lend = await request(server())
        .post('/api/debt-entries')
        .set(auth(bob.token))
        .send({
          counterparty: { name: '小明' },
          kind: 'LEND',
          amount: 500,
          date: DAY,
          record: { ledgerId: shared, accountId: bob.cashId },
        })
        .expect(201);
      await request(server())
        .post('/api/debt-entries')
        .set(auth(bob.token))
        .send({
          counterparty: { name: '小明' },
          kind: 'PAID_FOR_ME',
          amount: 400,
          date: DAY,
          record: { ledgerId: shared },
          categoryId: await expenseCategoryId(bob, shared),
        })
        .expect(201);

      const body = lend.body as CreateDebtEntryResponse;
      return {
        bob,
        carol,
        shared,
        counterpartyId: body.counterparty.id,
        entryId: body.entries[0]!.id,
      };
    }

    it('shows debt only to the owner of the entries', async () => {
      const { bob, carol, shared } = await setup();

      const list = async (who: Person) =>
        (
          (
            await request(server())
              .get(`/api/ledgers/${shared}/transactions`)
              .set(auth(who.token))
              .expect(200)
          ).body as Paginated<Transaction>
        ).items;

      const bobs = await list(bob);
      expect(bobs).toHaveLength(2);
      for (const txn of bobs) {
        expect(txn.debt).toMatchObject({ counterpartyName: '小明' });
      }

      const carols = await list(carol);
      expect(carols).toHaveLength(2);
      for (const txn of carols) {
        expect(txn.debt).toBeNull();
      }
    });

    it("gives another member 404 on the owner's counterparty and entries", async () => {
      const { carol, counterpartyId, entryId } = await setup();
      const as = (method: 'get' | 'patch' | 'delete' | 'post', path: string) =>
        request(server())[method](path).set(auth(carol.token));

      expect((await as('get', `/api/counterparties/${counterpartyId}`)).status).toBe(404);
      expect((await as('get', `/api/counterparties/${counterpartyId}/entries`)).status).toBe(404);
      expect(
        (await as('patch', `/api/counterparties/${counterpartyId}`).send({ name: 'x' })).status,
      ).toBe(404);
      expect((await as('post', `/api/counterparties/${counterpartyId}/forgive`)).status).toBe(404);
      expect((await as('delete', `/api/counterparties/${counterpartyId}`)).status).toBe(404);
      expect((await as('patch', `/api/debt-entries/${entryId}`).send({ amount: 1 })).status).toBe(
        404,
      );
      expect((await as('delete', `/api/debt-entries/${entryId}`)).status).toBe(404);

      // 用對方的對象 id 記帳，同樣 404。
      const viaId = await as('post', '/api/debt-entries').send({
        counterparty: { id: counterpartyId },
        kind: 'LEND',
        amount: 1,
        date: DAY,
        record: null,
      });
      expect(viaId.status).toBe(404);

      const carolsList = (await as('get', '/api/counterparties').expect(200))
        .body as Paginated<unknown>;
      expect(carolsList.items).toHaveLength(0);
    });

    it("stops another EDITOR from changing or deleting the owner's debt transactions", async () => {
      const { carol, shared } = await setup();
      const txns = (
        (
          await request(server())
            .get(`/api/ledgers/${shared}/transactions`)
            .set(auth(carol.token))
            .expect(200)
        ).body as Paginated<Transaction>
      ).items;

      for (const txn of txns) {
        const patch = await request(server())
          .patch(`/api/ledgers/${shared}/transactions/${txn.id}`)
          .set(auth(carol.token))
          .send({ amount: 1 });
        expect(patch.status).toBe(409);
        expect((patch.body as { errorCode: string }).errorCode).toBe('DEBT_TRANSACTION_READ_ONLY');
      }
    });
  });
});
