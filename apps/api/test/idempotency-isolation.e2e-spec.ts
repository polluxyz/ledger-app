import { INestApplication } from '@nestjs/common';
import type {
  Category,
  Counterparty,
  CreateDebtEntryResponse,
  Split,
  Transaction,
} from '@ledger/shared';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  httpServer,
  idempotencyKey,
  listAccounts,
  resetDb,
} from './e2e-utils';
import {
  auth,
  createCounterparty,
  DAY,
  getCounterparty,
  person,
  type Person,
} from './linking-utils';

/**
 * R1 防重複送出：先寫、先紅的兩組測試（spec SC-IK9 隔離、SC-IK3 並發重送）。
 *
 * SC-IK9 是資料隔離的防線：同一個鍵字串不能讓 B 拿到 A 的紀錄，A 失去權限後重送也拿不到。
 * 第 2、3 項靠現有的帳本 guard 已經擋住，留著當回歸；T1a 加入重送路徑後仍要擋住。
 *
 * SC-IK3 是這個機制最容易做錯的地方：5 個建立端點各用同一把鍵「真的同時」送 2 個請求
 * （`Promise.all`，不 mock），斷言 2 個都 201、回同一個 id，資料庫筆數與金額效果只有 1 次。
 * 後端還不認得 header 時，這組會建立 2 筆而失敗；T1a 完成後轉綠，斷言不改。
 */
describe('Idempotency isolation and concurrent replay (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);

  async function expenseCategoryId(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  async function cashBalance(who: Person): Promise<number> {
    return (await listAccounts(app, who.token)).find((account) => account.id === who.cashId)!
      .balance;
  }

  function postTransaction(
    who: Person,
    ledgerId: string,
    key: Record<string, string>,
    body: { amount: number; categoryId: string },
  ) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .set(key)
      .send({ type: 'EXPENSE', date: DAY, accountId: who.cashId, ...body });
  }

  /** B 建立共享帳本，A 以 editor 加入；回傳帳本 id。 */
  async function sharedLedgerWithEditor(owner: Person, editor: Person): Promise<string> {
    const ledgerId = await createSharedLedger(app, owner.token, '家用');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email: editor.email, role: 'EDITOR' })
      .expect(201);
    return ledgerId;
  }

  describe('SC-IK9 isolation', () => {
    it('lets another user reuse the same key string for their own record', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const key = idempotencyKey();

      const aliceRes = await postTransaction(alice, alice.ledgerId, key, {
        amount: 11100,
        categoryId: await expenseCategoryId(alice, alice.ledgerId),
      }).expect(201);
      const bobRes = await postTransaction(bob, bob.ledgerId, key, {
        amount: 22200,
        categoryId: await expenseCategoryId(bob, bob.ledgerId),
      }).expect(201);

      const aliceTxn = aliceRes.body as Transaction;
      const bobTxn = bobRes.body as Transaction;
      expect(bobTxn.id).not.toBe(aliceTxn.id);
      expect(bobTxn).toMatchObject({ amount: 22200, creator: { id: bob.userId } });
      // 回應不帶帳本 id，改從資料庫確認這筆記在 B 自己的帳本。
      expect(
        await prisma.transaction.findUniqueOrThrow({
          where: { id: bobTxn.id },
          select: { ledgerId: true },
        }),
      ).toEqual({ ledgerId: bob.ledgerId });
      expect(JSON.stringify(bobRes.body)).not.toContain(aliceTxn.id);
      expect(JSON.stringify(bobRes.body)).not.toContain(alice.ledgerId);
      expect(
        await prisma.transaction.count({ where: { ledgerId: alice.ledgerId, deletedAt: null } }),
      ).toBe(1);
      expect(
        await prisma.transaction.count({ where: { ledgerId: bob.ledgerId, deletedAt: null } }),
      ).toBe(1);
    });

    it('does not replay to a user who has left the ledger', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const ledgerId = await sharedLedgerWithEditor(bob, alice);
      const key = idempotencyKey();
      const body = { amount: 33300, categoryId: await expenseCategoryId(alice, ledgerId) };

      const created = (await postTransaction(alice, ledgerId, key, body).expect(201))
        .body as Transaction;
      // 取消勾選這筆，讓它留在共享帳本；A 退出後這筆仍在，但 A 已無權存取。
      await request(server())
        .post(`/api/ledgers/${ledgerId}/leave`)
        .set(auth(alice.token))
        .send({ targetLedgerId: null, excludedItemIds: [created.id] })
        .expect(204);

      const replay: Response = await postTransaction(alice, ledgerId, key, body);
      expect([403, 404]).toContain(replay.status);
      expect(JSON.stringify(replay.body)).not.toContain(created.id);
      expect(JSON.stringify(replay.body)).not.toContain('33300');
      expect(await prisma.transaction.count({ where: { ledgerId, deletedAt: null } })).toBe(1);
    });

    it('rejects a replay after the user is downgraded to viewer', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const ledgerId = await sharedLedgerWithEditor(bob, alice);
      const key = idempotencyKey();
      const body = { amount: 44400, categoryId: await expenseCategoryId(alice, ledgerId) };

      const created = (await postTransaction(alice, ledgerId, key, body).expect(201))
        .body as Transaction;
      await request(server())
        .patch(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
        .set(auth(bob.token))
        .send({ role: 'VIEWER' })
        .expect(200);

      const replay = await postTransaction(alice, ledgerId, key, body).expect(403);
      expect(JSON.stringify(replay.body)).not.toContain(created.id);
      expect(await prisma.transaction.count({ where: { ledgerId, deletedAt: null } })).toBe(1);
    });
  });

  describe('SC-IK3 concurrent requests with the same key', () => {
    /**
     * 同一把鍵、同一個內容，真的同時送 2 次。斷言 2 個都 201（沒有 500、沒有 409），
     * 回傳 `idOf` 取出的 id 相同；呼叫端再斷言資料庫與金額只動 1 次。
     */
    async function sendTwice(
      send: (key: Record<string, string>) => request.Test,
      idOf: (body: unknown) => string,
    ): Promise<string> {
      const key = idempotencyKey();
      const [first, second] = await Promise.all([send(key), send(key)]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(idOf(second.body)).toBe(idOf(first.body));
      return idOf(first.body);
    }

    it('creates one transaction', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const categoryId = await expenseCategoryId(alice, alice.ledgerId);
      const before = await cashBalance(alice);

      await sendTwice(
        (key) => postTransaction(alice, alice.ledgerId, key, { amount: 12300, categoryId }),
        (body) => (body as Transaction).id,
      );

      expect(
        await prisma.transaction.count({ where: { ledgerId: alice.ledgerId, deletedAt: null } }),
      ).toBe(1);
      expect(await cashBalance(alice)).toBe(before - 12300);
    });

    it('creates one debt entry', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      // 預先建好對象，避免 2 個請求同時用名字建立對象而互相干擾。
      const counterparty = await createCounterparty(app, alice, '小明');
      const before = await cashBalance(alice);

      await sendTwice(
        (key) =>
          request(server())
            .post('/api/debt-entries')
            .set(auth(alice.token))
            .set(key)
            .send({
              counterparty: { id: counterparty.id },
              kind: 'LEND',
              amount: 5000,
              date: DAY,
              record: { ledgerId: alice.ledgerId, accountId: alice.cashId },
            }),
        (body) => (body as CreateDebtEntryResponse).entries[0]!.id,
      );

      expect(
        await prisma.debtEntry.count({
          where: { counterpartyId: counterparty.id, deletedAt: null },
        }),
      ).toBe(1);
      expect((await getCounterparty(app, alice, counterparty.id)).balance).toBe(5000);
      expect(await cashBalance(alice)).toBe(before - 5000);
    });

    it('forgives once', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const counterparty: Counterparty = await createCounterparty(app, alice, '小明');
      await request(server())
        .post('/api/debt-entries')
        .set(auth(alice.token))
        .set(idempotencyKey())
        .send({
          counterparty: { id: counterparty.id },
          kind: 'LEND',
          amount: 5000,
          date: DAY,
          record: { ledgerId: alice.ledgerId, accountId: alice.cashId },
        })
        .expect(201);

      await sendTwice(
        (key) =>
          request(server())
            .post(`/api/counterparties/${counterparty.id}/forgive`)
            .set(auth(alice.token))
            .set(key)
            .send({ ledgerId: alice.ledgerId }),
        (body) => (body as CreateDebtEntryResponse).entries[0]!.id,
      );

      expect(
        await prisma.debtEntry.count({
          where: { counterpartyId: counterparty.id, kind: 'FORGIVE', deletedAt: null },
        }),
      ).toBe(1);
      expect((await getCounterparty(app, alice, counterparty.id)).balance).toBe(0);
    });

    it('creates one split', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const counterparty = await createCounterparty(app, alice, '小明');
      const categoryId = await expenseCategoryId(alice, alice.ledgerId);
      const before = await cashBalance(alice);

      await sendTwice(
        (key) =>
          request(server())
            .post('/api/splits')
            .set(auth(alice.token))
            .set(key)
            .send({
              type: 'EXPENSE',
              ledgerId: alice.ledgerId,
              categoryId,
              total: 30000,
              date: DAY,
              title: '晚餐',
              payer: null,
              accountId: alice.cashId,
              method: 'EQUAL',
              participants: [{ counterpartyId: null }, { counterpartyId: counterparty.id }],
            }),
        (body) => (body as Split).id,
      );

      expect(await prisma.split.count({ where: { ownerId: alice.userId, deletedAt: null } })).toBe(
        1,
      );
      expect(
        await prisma.debtEntry.count({
          where: { counterpartyId: counterparty.id, deletedAt: null },
        }),
      ).toBe(1);
      expect((await getCounterparty(app, alice, counterparty.id)).balance).toBe(15000);
      expect(await cashBalance(alice)).toBe(before - 30000);
    });

    it('creates one settlement', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const ledgerId = await sharedLedgerWithEditor(alice, bob);
      const personId = async (who: Person) =>
        (
          await prisma.ledgerPerson.findUniqueOrThrow({
            where: { ledgerId_userId: { ledgerId, userId: who.userId } },
          })
        ).id;
      const fromPersonId = await personId(bob);
      const toPersonId = await personId(alice);
      const before = await cashBalance(bob);

      await sendTwice(
        (key) =>
          request(server())
            .post(`/api/ledgers/${ledgerId}/settlements`)
            .set(auth(bob.token))
            .set(key)
            .send({
              fromPersonId,
              toPersonId,
              amount: 20000,
              date: DAY,
              fromAccountId: bob.cashId,
            }),
        (body) => (body as Transaction).id,
      );

      expect(
        await prisma.ledgerSettlement.count({
          where: { transaction: { ledgerId, deletedAt: null } },
        }),
      ).toBe(1);
      expect(await cashBalance(bob)).toBe(before - 20000);
    });
  });
});
