import { INestApplication } from '@nestjs/common';
import type {
  Category,
  CreateDebtEntryResponse,
  LedgerRemovalPreview,
  LedgerSummary,
  Split,
} from '@ledger/shared';
import request from 'supertest';
import { DebtEntriesService } from '../src/debts/debt-entries.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import {
  auth,
  createCounterparty,
  getCounterparty,
  linkPair,
  person,
  proposals,
  type Person,
} from './linking-utils';

/** 3j SC-J2～J5：真實撤銷、外鍵、回滾，以及預覽與刪除後餘額的一致性。 */
describe('Ledger delete and archive (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const day = '2026-10-17T12:00:00.000Z';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function category(who: Person, ledgerId = who.ledgerId, type = 'EXPENSE') {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(who.token))
      .query({ type })
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }
  async function trip(who: Person) {
    const res = await request(server())
      .post('/api/ledgers')
      .set(auth(who.token))
      .send({ name: 'Trip' })
      .expect(201);
    return (res.body as LedgerSummary).id;
  }
  async function debt(
    who: Person,
    ledgerId: string,
    counterpartyId: string,
    kind = 'LEND',
    amount = 9300,
    settle = false,
  ) {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({
        counterparty: { id: counterpartyId },
        kind,
        amount,
        ...(settle ? { settle } : {}),
        date: day,
        record: { ledgerId, accountId: who.cashId },
      })
      .expect(201);
    return res.body as CreateDebtEntryResponse;
  }
  async function preview(who: Person, ledgerId: string) {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/removal-preview`)
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerRemovalPreview;
  }
  async function acceptPending(who: Person) {
    for (const proposal of await proposals(app, who, 'incoming', 'PENDING')) {
      const paidForMe =
        proposal.entryKind === 'PAID_FOR_ME' || proposal.entryKind === 'RECEIVED_FOR_ME';
      await request(server())
        .post(`/api/debt-proposals/${proposal.id}/accept`)
        .set(auth(who.token))
        .send(
          paidForMe
            ? {
                record: { ledgerId: who.ledgerId },
                categoryId: await category(
                  who,
                  who.ledgerId,
                  proposal.entryKind === 'RECEIVED_FOR_ME' ? 'INCOME' : 'EXPENSE',
                ),
              }
            : { record: { ledgerId: who.ledgerId, accountId: who.cashId } },
        )
        .expect(200);
    }
  }
  async function split(
    who: Person,
    ledgerId: string,
    counterpartyId: string,
    otherPays = false,
    type = 'EXPENSE',
  ) {
    const res = await request(server())
      .post('/api/splits')
      .set(auth(who.token))
      .send({
        ledgerId,
        type,
        categoryId: await category(who, ledgerId, type),
        total: 2000,
        date: day,
        title: 'Dinner',
        payer: otherPays ? { counterpartyId } : null,
        ...(otherPays ? {} : { accountId: who.cashId }),
        method: 'EQUAL',
        participants: [{ counterpartyId: null }, { counterpartyId }],
      })
      .expect(201);
    return res.body as Split;
  }
  const remove = (who: Person, ledgerId: string, withdrawDebts?: boolean) =>
    request(server())
      .delete(`/api/ledgers/${ledgerId}`)
      .set(auth(who.token))
      .query({ confirm: 'Trip', ...(withdrawDebts === undefined ? {} : { withdrawDebts }) });

  it('SC-J2: unarchive returns 200, restores default listing and recording, and rejects an unarchived ledger', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const id = await trip(alice);
    await request(server()).post(`/api/ledgers/${id}/archive`).set(auth(alice.token)).expect(201);
    const before = await request(server()).get('/api/ledgers').set(auth(alice.token)).expect(200);
    expect((before.body as LedgerSummary[]).some((row) => row.id === id)).toBe(false);
    const restored = await request(server())
      .post(`/api/ledgers/${id}/unarchive`)
      .set(auth(alice.token))
      .expect(200);
    expect(restored.body as object).toMatchObject({
      id,
      archivedAt: null,
      members: [{ userId: alice.userId, role: 'OWNER' }],
    });
    const after = await request(server()).get('/api/ledgers').set(auth(alice.token)).expect(200);
    expect((after.body as LedgerSummary[]).some((row) => row.id === id)).toBe(true);
    await request(server())
      .post(`/api/ledgers/${id}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: day,
        accountId: alice.cashId,
        categoryId: await category(alice, id),
      })
      .expect(201);
    const again = await request(server())
      .post(`/api/ledgers/${id}/unarchive`)
      .set(auth(alice.token))
      .expect(409);
    expect(again.body as object).toMatchObject({ errorCode: 'LEDGER_NOT_ARCHIVED' });
  });

  it('SC-J3/J5: withdraws loans, repayment branches and splits atomically; preview matches both balances', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const { aCounterpartyId, bCounterpartyId } = await linkPair(app, alice, bob);
    const id = await trip(alice);
    await debt(alice, id, aCounterpartyId);
    await acceptPending(bob);
    const repaid = await debt(alice, id, aCounterpartyId, 'REPAYMENT', 9000, true);
    expect(repaid.entries[0]!.difference).toMatchObject({ type: 'EXPENSE', amount: 300 });
    await acceptPending(bob);
    await split(alice, id, aCounterpartyId);
    await acceptPending(bob);
    // 此筆在另一個帳本，刪除 Trip 不應撤銷它。
    const outside = await debt(alice, alice.ledgerId, aCounterpartyId, 'LEND', 77);
    const bankRes = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: 'Bank', initialBalance: 20000 })
      .expect(201);
    const bankId = (bankRes.body as { id: string }).id;
    await request(server())
      .post(`/api/ledgers/${id}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'TRANSFER',
        amount: 500,
        date: day,
        accountId: alice.cashId,
        toAccountId: bankId,
      })
      .expect(201);
    const before = await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } });
    const beforeTransactions = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });
    const beforeProposals = await prisma.debtProposal.findMany({ orderBy: { id: 'asc' } });
    const blocked = await remove(alice, id).expect(409);
    expect(blocked.body as object).toMatchObject({ errorCode: 'DEBT_WITHDRAWAL_REQUIRED' });
    expect(await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(
      beforeTransactions,
    );
    expect(await prisma.debtProposal.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeProposals);
    const impact = await preview(alice, id);
    expect(impact.delete.allowed).toBe(true);
    expect(impact.withdrawsDebts).toBe(true);
    expect(impact.counterparties[0]).toMatchObject({
      counterpartyId: aCounterpartyId,
      linked: true,
      balanceAfter: 77,
    });
    const bobBefore = await getCounterparty(app, bob, bCounterpartyId);
    await remove(alice, id, true).expect(204);
    const actualAccounts = await listAccounts(app, alice.token);
    for (const account of impact.accounts)
      expect(actualAccounts.find((row) => row.id === account.accountId)!.balance).toBe(
        account.balanceAfter,
      );
    expect((await getCounterparty(app, alice, aCounterpartyId)).balance).toBe(
      impact.counterparties[0]!.balanceAfter,
    );
    expect((await getCounterparty(app, bob, bCounterpartyId)).balance).toBe(bobBefore.balance);
    expect(
      (await proposals(app, bob, 'incoming', 'PENDING')).filter(
        (proposal) => proposal.type === 'DELETE',
      ),
    ).toHaveLength(3);
    expect(await prisma.ledger.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.split.count({ where: { ledgerId: id } })).toBe(0);
    const local = await prisma.debtEntry.findMany({
      where: { counterpartyId: aCounterpartyId, id: { not: outside.entries[0]!.id } },
    });
    expect(local).toHaveLength(3);
    expect(
      local.every(
        (row) => row.deletedAt !== null && row.transactionId === null && row.splitId === null,
      ),
    ).toBe(true);
  });

  it.each(['EXPENSE', 'INCOME'])(
    'SC-J3: %s split paid by the other person retains withdrawn null-linked history and deletion proposals',
    async (type) => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const { aCounterpartyId } = await linkPair(app, alice, bob);
      const id = await trip(alice);
      const created = await split(alice, id, aCounterpartyId, true, type);
      await acceptPending(bob);
      const original = await prisma.debtEntry.findFirstOrThrow({ where: { splitId: created.id } });
      // 核可的 CHECK 放寬只適用已撤銷紀錄，生效中的紀錄仍必須保留交易。
      await expect(
        prisma.debtEntry.update({ where: { id: original.id }, data: { transactionId: null } }),
      ).rejects.toThrow();
      const impact = await preview(alice, id);
      await remove(alice, id, true).expect(204);
      expect(
        await prisma.debtEntry.findUniqueOrThrow({ where: { id: original.id } }),
      ).toMatchObject({
        kind: type === 'EXPENSE' ? 'PAID_FOR_ME' : 'RECEIVED_FOR_ME',
        transactionId: null,
        splitId: null,
        deletedAt: expect.any(Date) as Date,
      });
      expect((await getCounterparty(app, alice, aCounterpartyId)).balance).toBe(
        impact.counterparties[0]!.balanceAfter,
      );
      const incoming = await proposals(app, bob, 'incoming', 'PENDING');
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.type).toBe('DELETE');
      // 提議的兩種讀取方向與歷史路徑不依賴已刪除帳本的交易。
      expect(await proposals(app, alice, 'outgoing', 'PENDING')).toHaveLength(1);
      await request(server())
        .get(`/api/counterparties/${aCounterpartyId}/entries`)
        .query({ section: 'history' })
        .set(auth(alice.token))
        .expect(200);
      await request(server())
        .post(`/api/debt-proposals/${incoming[0]!.id}/accept`)
        .set(auth(bob.token))
        .send({})
        .expect(200);
    },
  );

  it('SC-J3: already withdrawn loans do not require consent and their records remain', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const other = await createCounterparty(app, alice, 'Ming');
    const id = await trip(alice);
    const created = await debt(alice, id, other.id);
    await request(server())
      .delete(`/api/debt-entries/${created.entries[0]!.id}`)
      .set(auth(alice.token))
      .expect(204);
    expect((await preview(alice, id)).withdrawsDebts).toBe(false);
    await remove(alice, id).expect(204);
    expect(
      await prisma.debtEntry.findUniqueOrThrow({ where: { id: created.entries[0]!.id } }),
    ).toMatchObject({ transactionId: null, deletedAt: expect.any(Date) as Date });
  });

  it('rolls back the first actual withdrawal and retains the ledger when the second withdrawal fails', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const other = await createCounterparty(app, alice, 'Ming');
    const id = await trip(alice);
    await debt(alice, id, other.id);
    await debt(alice, id, other.id);
    const before = await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } });
    const beforeTransactions = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });
    const withdrawals = app.get(DebtEntriesService);
    const original = withdrawals.removeInTransaction.bind(withdrawals);
    let called = 0;
    const spy = jest
      .spyOn(withdrawals, 'removeInTransaction')
      .mockImplementation(async (...args) => {
        if (++called === 2) throw new Error('injected second withdrawal failure');
        await original(...args);
      });
    try {
      await remove(alice, id, true).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(called).toBe(2);
    expect(await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(
      beforeTransactions,
    );
    expect(await prisma.ledger.findUnique({ where: { id } })).not.toBeNull();
  });

  it('SC-K3: sole-member shared debts can be withdrawn; archive still blocks deletion', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const other = await createCounterparty(app, alice, 'Ming');
    const id = await createSharedLedger(app, alice.token, 'Trip');
    await debt(alice, id, other.id);
    expect((await preview(alice, id)).delete).toEqual({ allowed: true, blockedBy: null });
    expect((await remove(alice, id).expect(409)).body as object).toMatchObject({
      errorCode: 'DEBT_WITHDRAWAL_REQUIRED',
    });
    await request(server()).post(`/api/ledgers/${id}/archive`).set(auth(alice.token)).expect(201);
    expect(await preview(alice, id)).toEqual({
      accounts: [],
      counterparties: [],
      withdrawsDebts: false,
      delete: { allowed: false, blockedBy: 'LEDGER_ARCHIVED' },
    });
  });

  it('SC-J4: my transaction on another person’s temporary account blocks deletion even after soft deletion', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const id = await createSharedLedger(app, alice.token, 'Trip');
    await request(server())
      .post(`/api/ledgers/${id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const payer = await prisma.ledgerPerson.findUniqueOrThrow({
      where: { ledgerId_userId: { ledgerId: id, userId: bob.userId } },
    });
    const created = await request(server())
      .post(`/api/ledgers/${id}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 500,
        date: day,
        categoryId: await category(alice, id),
        payerPersonId: payer.id,
      })
      .expect(201);
    const transactionId = (created.body as { id: string }).id;
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: id, userId: bob.userId } },
    });
    const before = await listAccounts(app, bob.token);
    expect((await remove(alice, id, true).expect(409)).body as object).toMatchObject({
      errorCode: 'LEDGER_HAS_OTHERS_TRANSACTIONS',
    });
    expect((await preview(alice, id)).delete.blockedBy).toBe('HAS_OTHERS_TRANSACTIONS');
    expect(await listAccounts(app, bob.token)).toEqual(before);
    await request(server())
      .delete(`/api/ledgers/${id}/transactions/${transactionId}`)
      .set(auth(alice.token))
      .expect(204);
    expect((await remove(alice, id, true).expect(409)).body as object).toMatchObject({
      errorCode: 'LEDGER_HAS_OTHERS_TRANSACTIONS',
    });
    expect((await preview(alice, id)).delete.blockedBy).toBe('HAS_OTHERS_TRANSACTIONS');
  });

  it('rejects invalid withdrawal consent instead of interpreting it as false or true', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const id = await trip(alice);
    await request(server())
      .delete(`/api/ledgers/${id}`)
      .set(auth(alice.token))
      .query({ confirm: 'Trip', withdrawDebts: 'yes' })
      .expect(400);
    expect(await prisma.ledger.findUnique({ where: { id } })).not.toBeNull();
  });
});
