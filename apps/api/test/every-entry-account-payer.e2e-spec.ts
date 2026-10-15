import { INestApplication } from '@nestjs/common';
import type { Account, Category, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/** 3h SC-H8：替另一位成員記帳先落在他的臨時帳戶，由本人搬到真帳戶。 */
describe('Every entry has an account — payer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const day = '2026-10-14T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function scene() {
    const me = await person(app, 'alice@example.com', 'Alice');
    const xiaohua = await person(app, 'xiaohua@example.com', '小華');
    const ledgerId = await createSharedLedger(app, me.token, '花蓮三日');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(me.token))
      .send({ email: xiaohua.email, role: 'EDITOR' })
      .expect(201);
    const myPerson = await prisma.ledgerPerson.findUniqueOrThrow({
      where: { ledgerId_userId: { ledgerId, userId: me.userId } },
    });
    const huaPerson = await prisma.ledgerPerson.findUniqueOrThrow({
      where: { ledgerId_userId: { ledgerId, userId: xiaohua.userId } },
    });
    const temp = await prisma.account.findFirstOrThrow({
      where: { userId: me.userId, isTemporary: true },
    });
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(me.token))
      .expect(200);
    return {
      me,
      xiaohua,
      ledgerId,
      myPersonId: myPerson.id,
      huaPersonId: huaPerson.id,
      temporaryId: temp.id,
      categoryId: (categories.body as Category[])[0]!.id,
    };
  }

  async function balance(who: Person, accountId: string): Promise<number> {
    const accounts: Account[] = await listAccounts(app, who.token);
    return accounts.find((account) => account.id === accountId)!.balance;
  }

  async function view(ledgerId: string, transactionId: string, who: Person) {
    const response = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions/${transactionId}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Transaction;
  }

  it('moves an expense from my temporary account to cash', async () => {
    const s = await scene();
    const initialCash = await balance(s.me, s.me.cashId);
    const response = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.xiaohua.token))
      .send({
        type: 'EXPENSE',
        amount: 600,
        date: day,
        categoryId: s.categoryId,
        payerPersonId: s.myPersonId,
      })
      .expect(201);
    const transaction = response.body as Transaction;
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).accountId,
    ).toBe(s.temporaryId);
    expect(await balance(s.me, s.temporaryId)).toBe(-600);
    expect(await view(s.ledgerId, transaction.id, s.me)).toMatchObject({ accountPending: true });
    expect(await view(s.ledgerId, transaction.id, s.xiaohua)).toMatchObject({
      account: null,
      accountPending: false,
    });

    await request(server())
      .put(`/api/ledgers/${s.ledgerId}/transactions/${transaction.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(200);
    expect(await balance(s.me, s.temporaryId)).toBe(0);
    expect(await balance(s.me, s.me.cashId)).toBe(initialCash - 600);
    expect(await view(s.ledgerId, transaction.id, s.me)).toMatchObject({ accountPending: false });
    await request(server())
      .put(`/api/ledgers/${s.ledgerId}/transactions/${transaction.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(400);
  });

  it.each([
    { side: 'from', amount: -600 },
    { side: 'to', amount: 600 },
  ] as const)(
    'moves my $side settlement side from temporary account to cash',
    async ({ side, amount }) => {
      const s = await scene();
      const initialCash = await balance(s.me, s.me.cashId);
      const response = await request(server())
        .post(`/api/ledgers/${s.ledgerId}/settlements`)
        .set(auth(s.xiaohua.token))
        .send({
          fromPersonId: side === 'from' ? s.myPersonId : s.huaPersonId,
          toPersonId: side === 'from' ? s.huaPersonId : s.myPersonId,
          amount: 600,
          date: day,
          ...(side === 'from'
            ? { toAccountId: s.xiaohua.cashId }
            : { fromAccountId: s.xiaohua.cashId }),
        })
        .expect(201);
      const transaction = response.body as Transaction;
      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
      expect(side === 'from' ? row.accountId : row.toAccountId).toBe(s.temporaryId);
      expect(await balance(s.me, s.temporaryId)).toBe(amount);
      expect(await view(s.ledgerId, transaction.id, s.me)).toMatchObject({ accountPending: true });
      expect(await view(s.ledgerId, transaction.id, s.xiaohua)).toMatchObject({
        accountPending: false,
      });
      const settlement = await prisma.ledgerSettlement.findUniqueOrThrow({
        where: { transactionId: transaction.id },
      });
      await request(server())
        .put(`/api/ledgers/${s.ledgerId}/settlements/${settlement.id}/account`)
        .set(auth(s.me.token))
        .send({ accountId: s.me.cashId })
        .expect(200);
      expect(await balance(s.me, s.temporaryId)).toBe(0);
      expect(await balance(s.me, s.me.cashId)).toBe(initialCash + amount);
      expect(await view(s.ledgerId, transaction.id, s.me)).toMatchObject({ accountPending: false });
      await request(server())
        .put(`/api/ledgers/${s.ledgerId}/settlements/${settlement.id}/account`)
        .set(auth(s.me.token))
        .send({ accountId: s.me.cashId })
        .expect(400);
    },
  );

  it('keeps a nonmember payer without an account', async () => {
    const s = await scene();
    const guest = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/people`)
      .set(auth(s.me.token))
      .send({ name: '阿梅' })
      .expect(201);
    const response = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.xiaohua.token))
      .send({
        type: 'EXPENSE',
        amount: 600,
        date: day,
        categoryId: s.categoryId,
        payerPersonId: (guest.body as { id: string }).id,
      })
      .expect(201);
    const transaction = response.body as Transaction;
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).accountId,
    ).toBeNull();
    expect(transaction.accountPending).toBe(false);
  });
});
