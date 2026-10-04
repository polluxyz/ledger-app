import { INestApplication } from '@nestjs/common';
import type {
  Account,
  ApiErrorResponse,
  Category,
  CreateSettlementRequest,
  LedgerPerson,
  SettlementSummary,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 結清 e2e 以 Prisma 建立有名單的交易前置資料，讓測試聚焦在結清 API、餘額與淨額。
 * 覆蓋 SC-E4～E6、E9、E14，以及同一人、帳戶規則、PATCH 清帳戶與 DELETE 軟刪除。
 */
describe('Ledger settlements (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const DAY = '2026-10-04T12:00:00.000Z';
  const server = () => httpServer(app);

  interface Scene {
    alice: Person;
    bob: Person;
    charlie: Person;
    ledgerId: string;
    categoryId: string;
    people: { Alice: LedgerPerson; Bob: LedgerPerson; Charlie: LedgerPerson };
  }

  async function scene(tracksBalance = true): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', '小明');
    const charlie = await person(app, 'charlie@example.com', '小華');
    let ledgerId: string;
    if (tracksBalance) {
      ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    } else {
      const created = await request(server())
        .post('/api/ledgers')
        .set(auth(alice.token))
        .send({ name: '不連動帳本', kind: 'SHARED', tracksBalance: false })
        .expect(201);
      ledgerId = (created.body as { id: string }).id;
    }

    for (const member of [bob, charlie]) {
      await request(server())
        .post('/api/ledgers/' + ledgerId + '/members')
        .set(auth(alice.token))
        .send({ email: member.email, role: 'EDITOR' })
        .expect(201);
    }

    const people = await Promise.all(
      [
        { member: alice, name: 'Alice' },
        { member: bob, name: '小明' },
        { member: charlie, name: '小華' },
      ].map(async ({ member, name }) => {
        const row = await prisma.ledgerPerson.findUnique({
          where: { ledgerId_userId: { ledgerId, userId: member.userId } },
        });
        if (!row) throw new Error('Expected a ledger person for each member.');
        return { id: row.id, name, userId: row.userId, status: 'MEMBER' as const };
      }),
    );
    const categories = await request(server())
      .get('/api/ledgers/' + ledgerId + '/categories')
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);

    return {
      alice,
      bob,
      charlie,
      ledgerId,
      categoryId: (categories.body as Category[])[0]!.id,
      people: { Alice: people[0]!, Bob: people[1]!, Charlie: people[2]! },
    };
  }

  async function addSplitExpense(
    s: Scene,
    input: {
      creator: Person;
      payerPersonId: string;
      amount: number;
      participantIds: string[];
      accountId: string | null;
      note: string;
    },
  ): Promise<string> {
    return prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          ledgerId: s.ledgerId,
          creatorId: input.creator.userId,
          type: 'EXPENSE',
          amount: input.amount,
          date: new Date(DAY),
          categoryId: s.categoryId,
          accountId: input.accountId,
          toAccountId: null,
          payerPersonId: input.payerPersonId,
          note: input.note,
          title: null,
          splitId: null,
        },
        select: { id: true },
      });
      await tx.ledgerSplit.create({
        data: {
          transactionId: transaction.id,
          method: 'EQUAL',
          precision: 'CENT',
          shares: {
            create: input.participantIds.map((personId, sortOrder) => ({
              personId,
              share: input.amount / input.participantIds.length,
              ratio: null,
              sortOrder,
            })),
          },
        },
      });
      return transaction.id;
    });
  }

  async function addTripExpenses(s: Scene): Promise<void> {
    const all = [s.people.Alice.id, s.people.Bob.id, s.people.Charlie.id];
    await addSplitExpense(s, {
      creator: s.alice,
      payerPersonId: s.people.Alice.id,
      amount: 600000,
      participantIds: all,
      accountId: s.alice.cashId,
      note: '住宿',
    });
    await addSplitExpense(s, {
      creator: s.bob,
      payerPersonId: s.people.Bob.id,
      amount: 150000,
      participantIds: all,
      accountId: s.bob.cashId,
      note: '晚餐',
    });
    await addSplitExpense(s, {
      creator: s.charlie,
      payerPersonId: s.people.Charlie.id,
      amount: 90000,
      participantIds: [s.people.Alice.id, s.people.Charlie.id],
      accountId: s.charlie.cashId,
      note: '油錢',
    });
  }

  function settlement(who: Person, ledgerId: string, body: CreateSettlementRequest) {
    return request(server())
      .post('/api/ledgers/' + ledgerId + '/settlements')
      .set(auth(who.token))
      .send(body);
  }

  async function summary(who: Person, ledgerId: string): Promise<SettlementSummary> {
    const response = await request(server())
      .get('/api/ledgers/' + ledgerId + '/settlement-summary')
      .set(auth(who.token))
      .expect(200);
    return response.body as SettlementSummary;
  }

  async function settlementIdFor(transactionId: string): Promise<string> {
    const row = await prisma.ledgerSettlement.findUnique({
      where: { transactionId },
      select: { id: true },
    });
    if (!row) throw new Error('Expected a LedgerSettlement row for the transaction.');
    return row.id;
  }

  async function balanceOf(who: Person, accountId: string): Promise<number> {
    const accounts: Account[] = await listAccounts(app, who.token);
    const account = accounts.find((row) => row.id === accountId);
    if (!account) throw new Error('Expected the account in its owner account list.');
    return account.balance;
  }

  function namedNets(result: SettlementSummary): Array<[string, string, number]> {
    return result.people.map(({ person: ledgerPerson, net }) => [
      ledgerPerson.name,
      ledgerPerson.status,
      net,
    ]);
  }

  it('SC-E4–E6: summarizes the trip, records settlements, and handles overpayment', async () => {
    const s = await scene();
    await addTripExpenses(s);

    const before = await summary(s.alice, s.ledgerId);
    expect(namedNets(before)).toEqual([
      ['Alice', 'MEMBER', 305000],
      ['小明', 'MEMBER', -100000],
      ['小華', 'MEMBER', -205000],
    ]);
    expect(before.suggestions).toEqual([
      { fromPersonId: s.people.Charlie.id, toPersonId: s.people.Alice.id, amount: 205000 },
      { fromPersonId: s.people.Bob.id, toPersonId: s.people.Alice.id, amount: 100000 },
    ]);

    const charlieBefore = await balanceOf(s.charlie, s.charlie.cashId);
    const aliceBefore = await balanceOf(s.alice, s.alice.cashId);
    const created = await settlement(s.charlie, s.ledgerId, {
      toPersonId: s.people.Alice.id,
      amount: 205000,
      date: DAY,
      fromAccountId: s.charlie.cashId,
    }).expect(201);
    const charlieSettlement = created.body as Transaction;
    const charlieSettlementId = await settlementIdFor(charlieSettlement.id);
    const charlieRow = await prisma.transaction.findUnique({
      where: { id: charlieSettlement.id },
      select: { accountId: true, toAccountId: true },
    });
    expect(charlieRow).toEqual({ accountId: s.charlie.cashId, toAccountId: null });
    expect(await balanceOf(s.charlie, s.charlie.cashId)).toBe(charlieBefore - 205000);
    expect(await balanceOf(s.alice, s.alice.cashId)).toBe(aliceBefore);

    await request(server())
      .put('/api/ledgers/' + s.ledgerId + '/settlements/' + charlieSettlementId + '/account')
      .set(auth(s.alice.token))
      .send({ accountId: s.alice.cashId })
      .expect(200);
    expect(await balanceOf(s.alice, s.alice.cashId)).toBe(aliceBefore + 205000);
    const afterCharliePaid = await summary(s.alice, s.ledgerId);
    expect(namedNets(afterCharliePaid)).toEqual([
      ['Alice', 'MEMBER', 100000],
      ['小明', 'MEMBER', -100000],
      ['小華', 'MEMBER', 0],
    ]);

    await settlement(s.bob, s.ledgerId, {
      toPersonId: s.people.Alice.id,
      amount: 120000,
      date: DAY,
      fromAccountId: s.bob.cashId,
    }).expect(201);
    const afterOverpayment = await summary(s.alice, s.ledgerId);
    expect(namedNets(afterOverpayment)).toEqual([
      ['Alice', 'MEMBER', -20000],
      ['小明', 'MEMBER', 20000],
      ['小華', 'MEMBER', 0],
    ]);
    expect(afterOverpayment.suggestions).toEqual([
      { fromPersonId: s.people.Alice.id, toPersonId: s.people.Bob.id, amount: 20000 },
    ]);
  });

  it('SC-E9: includes a guest payer and leaves the receiving side without an account', async () => {
    const s = await scene();
    await addTripExpenses(s);
    const guest = await prisma.ledgerPerson.create({
      data: { ledgerId: s.ledgerId, userId: null, name: '阿美' },
    });
    await addSplitExpense(s, {
      creator: s.alice,
      payerPersonId: guest.id,
      amount: 80000,
      participantIds: [s.people.Alice.id, guest.id],
      accountId: null,
      note: '門票',
    });

    const before = await summary(s.alice, s.ledgerId);
    expect(namedNets(before)).toEqual([
      ['Alice', 'MEMBER', 265000],
      ['小明', 'MEMBER', -100000],
      ['小華', 'MEMBER', -205000],
      ['阿美', 'GUEST', 40000],
    ]);
    expect(before.suggestions).toEqual([
      { fromPersonId: s.people.Charlie.id, toPersonId: s.people.Alice.id, amount: 205000 },
      { fromPersonId: s.people.Bob.id, toPersonId: s.people.Alice.id, amount: 60000 },
      { fromPersonId: s.people.Bob.id, toPersonId: guest.id, amount: 40000 },
    ]);

    const bobBefore = await balanceOf(s.bob, s.bob.cashId);
    const created = await settlement(s.bob, s.ledgerId, {
      toPersonId: guest.id,
      amount: 40000,
      date: DAY,
      fromAccountId: s.bob.cashId,
    }).expect(201);
    const transaction = created.body as Transaction;
    const saved = await prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: { accountId: true, toAccountId: true },
    });
    expect(saved).toEqual({ accountId: s.bob.cashId, toAccountId: null });
    expect(await balanceOf(s.bob, s.bob.cashId)).toBe(bobBefore - 40000);
  });

  it('SC-E14: keeps a departed member in summary and accepts a settlement on their behalf', async () => {
    const s = await scene();
    await addTripExpenses(s);
    await request(server())
      .delete('/api/ledgers/' + s.ledgerId + '/members/' + s.bob.userId)
      .set(auth(s.bob.token))
      .expect(204);

    const before = await summary(s.alice, s.ledgerId);
    expect(namedNets(before)).toEqual([
      ['Alice', 'MEMBER', 305000],
      ['小明', 'LEFT', -100000],
      ['小華', 'MEMBER', -205000],
    ]);

    const created = await settlement(s.alice, s.ledgerId, {
      fromPersonId: s.people.Bob.id,
      toPersonId: s.people.Alice.id,
      amount: 100000,
      date: DAY,
      toAccountId: s.alice.cashId,
    }).expect(201);
    const transfer = created.body as Transaction;
    const saved = await prisma.transaction.findUnique({
      where: { id: transfer.id },
      select: { accountId: true, toAccountId: true },
    });
    expect(saved).toEqual({ accountId: null, toAccountId: s.alice.cashId });
  });

  it('rejects invalid account combinations without leaving a transaction', async () => {
    const s = await scene();
    const samePerson = await settlement(s.alice, s.ledgerId, {
      fromPersonId: s.people.Alice.id,
      toPersonId: s.people.Alice.id,
      amount: 100,
      date: DAY,
      fromAccountId: s.alice.cashId,
    }).expect(400);
    expect((samePerson.body as ApiErrorResponse).errorCode).toBe('SETTLEMENT_SAME_PERSON');

    const missingAccount = await settlement(s.alice, s.ledgerId, {
      toPersonId: s.people.Bob.id,
      amount: 100,
      date: DAY,
    }).expect(400);
    expect((missingAccount.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_REQUIRED');

    const otherPayerAccount = await settlement(s.alice, s.ledgerId, {
      fromPersonId: s.people.Bob.id,
      toPersonId: s.people.Alice.id,
      amount: 100,
      date: DAY,
      fromAccountId: s.bob.cashId,
      toAccountId: s.alice.cashId,
    }).expect(400);
    expect((otherPayerAccount.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_PAYERS');
    expect(await prisma.transaction.count({ where: { ledgerId: s.ledgerId } })).toBe(0);
    expect(await prisma.ledgerSettlement.count()).toBe(0);
  });

  it('allows account-free settlements in a non-tracking ledger and rejects supplied accounts', async () => {
    const s = await scene(false);
    const created = await settlement(s.alice, s.ledgerId, {
      toPersonId: s.people.Bob.id,
      amount: 50000,
      date: DAY,
    }).expect(201);
    const saved = await prisma.transaction.findUnique({
      where: { id: (created.body as Transaction).id },
      select: { accountId: true, toAccountId: true },
    });
    expect(saved).toEqual({ accountId: null, toAccountId: null });

    const withAccount = await settlement(s.alice, s.ledgerId, {
      toPersonId: s.people.Bob.id,
      amount: 50000,
      date: DAY,
      fromAccountId: s.alice.cashId,
    }).expect(400);
    expect((withAccount.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_ALLOWED');
    expect(await prisma.ledgerSettlement.count()).toBe(1);
  });

  it('returns 404 for every settlement route on a personal ledger', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const base = '/api/ledgers/' + alice.ledgerId;
    const settlementId = '00000000-0000-4000-8000-000000000001';

    await request(server())
      .get(base + '/settlement-summary')
      .set(auth(alice.token))
      .expect(404);
    await request(server())
      .post(base + '/settlements')
      .set(auth(alice.token))
      .send({
        toPersonId: settlementId,
        amount: 100,
        date: DAY,
        fromAccountId: alice.cashId,
      })
      .expect(404);
    await request(server())
      .patch(base + '/settlements/' + settlementId)
      .set(auth(alice.token))
      .send({ amount: 100 })
      .expect(404);
    await request(server())
      .delete(base + '/settlements/' + settlementId)
      .set(auth(alice.token))
      .expect(404);
    await request(server())
      .put(base + '/settlements/' + settlementId + '/account')
      .set(auth(alice.token))
      .send({ accountId: alice.cashId })
      .expect(404);
    expect(await prisma.transaction.count({ where: { ledgerId: alice.ledgerId } })).toBe(0);
  });

  it('clears a changed receiver account on PATCH and restores totals on DELETE', async () => {
    const s = await scene();
    const aliceBefore = await balanceOf(s.alice, s.alice.cashId);
    const bobBefore = await balanceOf(s.bob, s.bob.cashId);
    const created = await settlement(s.alice, s.ledgerId, {
      toPersonId: s.people.Bob.id,
      amount: 50000,
      date: DAY,
      fromAccountId: s.alice.cashId,
    }).expect(201);
    const transaction = created.body as Transaction;
    const id = await settlementIdFor(transaction.id);

    await request(server())
      .put('/api/ledgers/' + s.ledgerId + '/settlements/' + id + '/account')
      .set(auth(s.bob.token))
      .send({ accountId: s.bob.cashId })
      .expect(200);
    expect(await balanceOf(s.bob, s.bob.cashId)).toBe(bobBefore + 50000);

    await request(server())
      .patch('/api/ledgers/' + s.ledgerId + '/settlements/' + id)
      .set(auth(s.alice.token))
      .send({ toPersonId: s.people.Charlie.id })
      .expect(200);
    const patched = await prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: { accountId: true, toAccountId: true },
    });
    expect(patched).toEqual({ accountId: s.alice.cashId, toAccountId: null });
    expect(await balanceOf(s.bob, s.bob.cashId)).toBe(bobBefore);
    expect(namedNets(await summary(s.alice, s.ledgerId))).toEqual([
      ['Alice', 'MEMBER', 50000],
      ['小明', 'MEMBER', 0],
      ['小華', 'MEMBER', -50000],
    ]);

    await request(server())
      .delete('/api/ledgers/' + s.ledgerId + '/settlements/' + id)
      .set(auth(s.alice.token))
      .expect(204);
    const removed = await prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: { deletedAt: true },
    });
    expect(removed?.deletedAt).toBeInstanceOf(Date);
    expect(namedNets(await summary(s.alice, s.ledgerId))).toEqual([
      ['Alice', 'MEMBER', 0],
      ['小明', 'MEMBER', 0],
      ['小華', 'MEMBER', 0],
    ]);
    expect(await balanceOf(s.alice, s.alice.cashId)).toBe(aliceBefore);
  });
});
