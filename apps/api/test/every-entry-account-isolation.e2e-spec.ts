import { INestApplication } from '@nestjs/common';
import type {
  Account,
  Category,
  CreateDebtEntryResponse,
  RecordDefaults,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 3h 的授權與資料隔離（spec `phase-3h-every-entry-has-account.md` SC-H11）。協調者在實作前寫好，
 * 先看到紅燈。
 *
 * 3h 讓後端替別人選帳戶（付款人是別的成員 → 他的臨時帳戶），也多了三種新東西：臨時帳戶、結清分支、
 * 呆帳交易，以及「最近一次」的預設值。這些都只能縮小或維持原本的範圍：
 * - 臨時帳戶只能由後端代填。任何人（包括本人）把臨時帳戶 id 送進來都被擋；別人的帳戶照舊 404，
 *   不透露它存在。
 * - 別人替我記的交易進我的臨時帳戶，但其他成員看到的帳戶照舊遮成 null，`accountPending` 只對我是 true。
 * - `GET /accounts`、`record-defaults` 只回我自己的帳戶；`?ledgerId=` 帶我沒權限的帳本 404。
 * - 別人的分支、別人的呆帳交易一律 404，改或刪也一樣。
 *
 * 場景：Alice（OWNER）建共享帳本「花蓮三日」，Bob 是 EDITOR。Eve 不在帳本裡。
 */
describe('Every entry has an account — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-14T12:00:00.000Z';

  interface Scene {
    alice: Person;
    bob: Person;
    eve: Person;
    ledgerId: string;
    categoryId: string;
    bobPersonId: string;
    alicePersonId: string;
  }

  async function scene(): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const personOf = async (userId: string) => {
      const row = await prisma.ledgerPerson.findUnique({
        where: { ledgerId_userId: { ledgerId, userId } },
      });
      if (!row) throw new Error('Expected a ledger person for each member.');
      return row.id;
    };
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);
    return {
      alice,
      bob,
      eve,
      ledgerId,
      categoryId: (categories.body as Category[])[0]!.id,
      alicePersonId: await personOf(alice.userId),
      bobPersonId: await personOf(bob.userId),
    };
  }

  /** 臨時帳戶的 id。3h 之前沒有這個欄位或沒有這一列，測試在這裡就會紅。 */
  async function temporaryAccountId(who: Person): Promise<string> {
    const rows = await prisma.account.findMany({
      where: { userId: who.userId, isTemporary: true },
      select: { id: true },
    });
    expect(rows).toHaveLength(1);
    return rows[0]!.id;
  }

  async function personalExpenseCategory(who: Person): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  /** Alice 在花蓮三日記一筆 Bob 付的晚餐：後端要把它記到 Bob 的臨時帳戶。 */
  async function expensePaidByBob(s: Scene): Promise<Transaction> {
    const res = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.alice.token))
      .send({
        type: 'EXPENSE',
        amount: 60000,
        date: DAY,
        categoryId: s.categoryId,
        payerPersonId: s.bobPersonId,
      })
      .expect(201);
    return res.body as Transaction;
  }

  describe('臨時帳戶只能由後端代填', () => {
    it('別人的臨時帳戶當 accountId：404，不透露它存在', async () => {
      const s = await scene();
      const bobTemp = await temporaryAccountId(s.bob);
      const categoryId = await personalExpenseCategory(s.alice);

      await request(server())
        .post(`/api/ledgers/${s.alice.ledgerId}/transactions`)
        .set(auth(s.alice.token))
        .send({ type: 'EXPENSE', amount: 100, date: DAY, categoryId, accountId: bobTemp })
        .expect(404);
      await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { name: '明哥' },
          kind: 'LEND',
          amount: 100,
          date: DAY,
          record: { ledgerId: s.alice.ledgerId, accountId: bobTemp },
        })
        .expect(404);
    });

    it('自己的臨時帳戶當 accountId：400 TEMPORARY_ACCOUNT_NOT_SELECTABLE', async () => {
      const s = await scene();
      const aliceTemp = await temporaryAccountId(s.alice);
      const categoryId = await personalExpenseCategory(s.alice);

      const tx = await request(server())
        .post(`/api/ledgers/${s.alice.ledgerId}/transactions`)
        .set(auth(s.alice.token))
        .send({ type: 'EXPENSE', amount: 100, date: DAY, categoryId, accountId: aliceTemp })
        .expect(400);
      expect(tx.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE' });

      const debt = await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { name: '明哥' },
          kind: 'LEND',
          amount: 100,
          date: DAY,
          record: { ledgerId: s.alice.ledgerId, accountId: aliceTemp },
        })
        .expect(400);
      expect(debt.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE' });

      const settlement = await request(server())
        .post(`/api/ledgers/${s.ledgerId}/settlements`)
        .set(auth(s.alice.token))
        .send({
          fromPersonId: s.alicePersonId,
          toPersonId: s.bobPersonId,
          amount: 100,
          date: DAY,
          fromAccountId: aliceTemp,
        })
        .expect(400);
      expect(settlement.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE' });
    });

    it('別人替我記的交易：我換帳戶不能換到臨時帳戶；別人不能替我換', async () => {
      const s = await scene();
      const tx = await expensePaidByBob(s);
      const bobTemp = await temporaryAccountId(s.bob);
      const aliceTemp = await temporaryAccountId(s.alice);

      const toTemp = await request(server())
        .put(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}/account`)
        .set(auth(s.bob.token))
        .send({ accountId: bobTemp })
        .expect(400);
      expect(toTemp.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE' });

      // Alice 不是付款人：換成她自己的帳戶照舊被擋，換成任何臨時帳戶也一樣被擋。
      await request(server())
        .put(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}/account`)
        .set(auth(s.alice.token))
        .send({ accountId: s.alice.cashId })
        .expect(400);
      for (const accountId of [aliceTemp, bobTemp]) {
        const res = await request(server())
          .put(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}/account`)
          .set(auth(s.alice.token))
          .send({ accountId });
        expect([400, 404]).toContain(res.status);
      }
      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(row.accountId).toBe(bobTemp);
    });
  });

  describe('別人替我記的交易', () => {
    it('記到付款人的臨時帳戶；其他成員看到的帳戶遮成 null，accountPending 只對付款人是 true', async () => {
      const s = await scene();
      const tx = await expensePaidByBob(s);
      const bobTemp = await temporaryAccountId(s.bob);

      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(row.accountId).toBe(bobTemp);

      const asAlice = await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}`)
        .set(auth(s.alice.token))
        .expect(200);
      expect(asAlice.body).toMatchObject({ account: null, accountPending: false });

      const asBob = await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}`)
        .set(auth(s.bob.token))
        .expect(200);
      expect(asBob.body).toMatchObject({ accountPending: true });

      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}`)
        .set(auth(s.eve.token))
        .expect(404);
    });
  });

  describe('帳戶清單與預設值只回自己的', () => {
    it('GET /accounts 只回我的帳戶，剛好一個臨時帳戶', async () => {
      const s = await scene();
      await expensePaidByBob(s);
      const bobTemp = await temporaryAccountId(s.bob);

      const res = await request(server()).get('/api/accounts').set(auth(s.alice.token)).expect(200);
      const accounts = res.body as Account[];
      expect(accounts.map((a) => a.id)).not.toContain(bobTemp);
      expect(accounts.filter((a) => a.isTemporary)).toHaveLength(1);
    });

    it('record-defaults 不回別人的帳戶；帶我沒權限的帳本 404', async () => {
      const s = await scene();
      // Bob 記一筆自己付的，Alice 什麼都沒記：Alice 的預設值不能拿到 Bob 的帳戶或帳本。
      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/transactions`)
        .set(auth(s.bob.token))
        .send({
          type: 'EXPENSE',
          amount: 100,
          date: DAY,
          categoryId: s.categoryId,
          payerPersonId: s.bobPersonId,
          accountId: s.bob.cashId,
        })
        .expect(201);

      const mine = await request(server())
        .get('/api/users/me/record-defaults')
        .set(auth(s.alice.token))
        .expect(200);
      expect(mine.body as RecordDefaults).toEqual({ ledgerId: null, accountId: null });

      const inShared = await request(server())
        .get('/api/users/me/record-defaults')
        .query({ ledgerId: s.ledgerId })
        .set(auth(s.alice.token))
        .expect(200);
      expect((inShared.body as RecordDefaults).accountId).not.toBe(s.bob.cashId);

      await request(server())
        .get('/api/users/me/record-defaults')
        .query({ ledgerId: s.bob.ledgerId })
        .set(auth(s.alice.token))
        .expect(404);
      await request(server())
        .get('/api/users/me/record-defaults')
        .query({ ledgerId: s.ledgerId })
        .set(auth(s.eve.token))
        .expect(404);
    });
  });

  describe('分支與呆帳交易', () => {
    it('別人的分支 404，改或刪也 404', async () => {
      const s = await scene();
      const lent = await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { name: '房東' },
          kind: 'LEND',
          amount: 9300,
          date: DAY,
          record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
        })
        .expect(201);
      const repaid = await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { id: (lent.body as CreateDebtEntryResponse).counterparty.id },
          kind: 'REPAYMENT',
          amount: 9000,
          date: DAY,
          settle: true,
          record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
        })
        .expect(201);
      const difference = (repaid.body as CreateDebtEntryResponse).entries[0]!.difference;
      expect(difference).not.toBeNull();
      const path = `/api/ledgers/${s.alice.ledgerId}/transactions/${difference!.transactionId}`;

      await request(server()).get(path).set(auth(s.eve.token)).expect(404);
      await request(server()).patch(path).set(auth(s.eve.token)).send({ amount: 1 }).expect(404);
      await request(server()).delete(path).set(auth(s.eve.token)).expect(404);
      // 本人從交易端點改也不行：分支只能從還款那一筆改（照借還交易的既有規則）。
      await request(server()).delete(path).set(auth(s.alice.token)).expect(409);
    });

    it('別人不能免除我的對象，也不能把呆帳記到別人的帳本', async () => {
      const s = await scene();
      const lent = await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { name: '明哥' },
          kind: 'LEND',
          amount: 50000,
          date: DAY,
          record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
        })
        .expect(201);
      const counterpartyId = (lent.body as CreateDebtEntryResponse).counterparty.id;

      await request(server())
        .post(`/api/counterparties/${counterpartyId}/forgive`)
        .set(auth(s.eve.token))
        .send({ ledgerId: s.eve.ledgerId })
        .expect(404);
      await request(server())
        .post(`/api/counterparties/${counterpartyId}/forgive`)
        .set(auth(s.alice.token))
        .send({ ledgerId: s.eve.ledgerId })
        .expect(404);

      const forgiven = await request(server())
        .post(`/api/counterparties/${counterpartyId}/forgive`)
        .set(auth(s.alice.token))
        .send({ ledgerId: s.alice.ledgerId })
        .expect(201);
      const transactionId = (forgiven.body as CreateDebtEntryResponse).entries[0]!.transactionId;
      expect(transactionId).not.toBeNull();
      await request(server())
        .get(`/api/ledgers/${s.alice.ledgerId}/transactions/${transactionId}`)
        .set(auth(s.eve.token))
        .expect(404);
    });
  });
});
