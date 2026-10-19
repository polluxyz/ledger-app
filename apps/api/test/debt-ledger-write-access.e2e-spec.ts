import { INestApplication } from '@nestjs/common';
import type { CreateDebtEntryResponse } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, linkPair, person, proposals, type Person } from './linking-utils';

/**
 * 3j SC-J1 的補充：成員退出後所有寫入回 404；還款含差額分支時，失敗也不能改掉分支。
 * 透過 HTTP 建立連動與提議，完整比對紀錄、交易和提議，驗證資料庫交易確實回滾。
 */
describe('Debt ledger write access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const DAY = '2026-10-17T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function incoming(who: Person) {
    return (await proposals(app, who, 'incoming', 'PENDING'))[0]!;
  }

  async function write(
    who: Person,
    counterpartyId: string,
    ledgerId: string,
    kind: string,
    amount: number,
    settle = false,
  ) {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({
        counterparty: { id: counterpartyId },
        kind,
        amount,
        date: DAY,
        ...(settle ? { settle } : {}),
        record: { ledgerId, accountId: who.cashId },
      })
      .expect(201);
    return (res.body as CreateDebtEntryResponse).entries[0]!;
  }

  async function scene() {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const ledgerId = await createSharedLedger(app, carol.token, '共享帳本');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(carol.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const { aCounterpartyId, bCounterpartyId } = await linkPair(app, alice, bob);
    await write(alice, aCounterpartyId, alice.ledgerId, 'LEND', 1000);
    await request(server())
      .post(`/api/debt-proposals/${(await incoming(bob)).id}/accept`)
      .set(auth(bob.token))
      .send({ record: { ledgerId, accountId: bob.cashId } })
      .expect(200);
    const aliceEntry = await write(alice, aCounterpartyId, alice.ledgerId, 'REPAYMENT', 900, true);
    await request(server())
      .post(`/api/debt-proposals/${(await incoming(bob)).id}/accept`)
      .set(auth(bob.token))
      .send({ record: { ledgerId, accountId: bob.cashId } })
      .expect(200);
    const bobEntry = await prisma.debtEntry.findFirstOrThrow({
      where: { counterpartyId: bCounterpartyId, kind: 'REPAY', deletedAt: null },
    });
    return { alice, bob, carol, ledgerId, aliceEntry, bobEntry };
  }

  async function snapshot(entryId: string) {
    const entry = await prisma.debtEntry.findUniqueOrThrow({ where: { id: entryId } });
    const transactions = await prisma.transaction.findMany({
      where: { OR: [{ id: entry.transactionId! }, { differenceOfId: entry.transactionId }] },
      orderBy: { id: 'asc' },
    });
    return { entry, transactions };
  }

  it.each([
    ['non-member', 404, 'NOT_FOUND'],
    ['viewer', 403, 'FORBIDDEN'],
    ['archived', 409, 'LEDGER_ARCHIVED'],
  ] as const)(
    '%s cannot change a repayment or its branch, including via proposals',
    async (restriction, status, errorCode) => {
      const s = await scene();
      if (restriction === 'non-member') {
        await prisma.ledgerMember.delete({
          where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: s.bob.userId } },
        });
      } else if (restriction === 'viewer') {
        await request(server())
          .patch(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
          .set(auth(s.carol.token))
          .send({ role: 'VIEWER' })
          .expect(200);
      } else {
        await request(server())
          .post(`/api/ledgers/${s.ledgerId}/archive`)
          .set(auth(s.carol.token))
          .expect(201);
      }
      const before = await snapshot(s.bobEntry.id);
      expect(before.transactions).toHaveLength(2);
      for (const body of [
        { amount: 950 },
        { note: '備註' },
        { date: '2026-10-18T12:00:00.000Z' },
      ]) {
        const res = await request(server())
          .patch(`/api/debt-entries/${s.bobEntry.id}`)
          .set(auth(s.bob.token))
          .send(body)
          .expect(status);
        expect((res.body as { errorCode: string }).errorCode).toBe(errorCode);
      }
      await request(server())
        .delete(`/api/debt-entries/${s.bobEntry.id}`)
        .set(auth(s.bob.token))
        .expect(status);
      expect(await snapshot(s.bobEntry.id)).toEqual(before);

      await request(server())
        .patch(`/api/debt-entries/${s.aliceEntry.id}`)
        .set(auth(s.alice.token))
        .send({ amount: 950 })
        .expect(200);
      const amend = await incoming(s.bob);
      const amendBefore = await prisma.debtProposal.findUniqueOrThrow({ where: { id: amend.id } });
      await request(server())
        .post(`/api/debt-proposals/${amend.id}/accept`)
        .set(auth(s.bob.token))
        .send({})
        .expect(status);
      expect(await snapshot(s.bobEntry.id)).toEqual(before);
      expect(await prisma.debtProposal.findUniqueOrThrow({ where: { id: amend.id } })).toEqual(
        amendBefore,
      );
      await request(server())
        .post(`/api/debt-proposals/${amend.id}/decline`)
        .set(auth(s.bob.token))
        .expect(200);

      await request(server())
        .delete(`/api/debt-entries/${s.aliceEntry.id}`)
        .set(auth(s.alice.token))
        .expect(204);
      const deletion = await incoming(s.bob);
      const deleteBefore = await prisma.debtProposal.findUniqueOrThrow({
        where: { id: deletion.id },
      });
      // 發起者撤銷時會清除配對；接受失敗不能再改動接受者的紀錄、交易或提議。
      const beforeDelete = await snapshot(s.bobEntry.id);
      await request(server())
        .post(`/api/debt-proposals/${deletion.id}/accept`)
        .set(auth(s.bob.token))
        .send({})
        .expect(status);
      expect(await snapshot(s.bobEntry.id)).toEqual(beforeDelete);
      expect(await prisma.debtProposal.findUniqueOrThrow({ where: { id: deletion.id } })).toEqual(
        deleteBefore,
      );
      await request(server())
        .post(`/api/debt-proposals/${deletion.id}/decline`)
        .set(auth(s.bob.token))
        .expect(200);
      expect(await snapshot(s.bobEntry.id)).toEqual(beforeDelete);
    },
  );
});
