import { INestApplication } from '@nestjs/common';
import type { CreateDebtEntryResponse, DebtEntry, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, getCounterparty, linkPair, person, proposals, type Person } from './linking-utils';

/** 3h 的借還路徑以 HTTP 與真實資料庫驗證：還款只寫一筆往來，分支與呆帳各是一筆交易。 */
describe('Every entry has an account — debts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const date = '2026-10-14T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  function record(who: Person) {
    return { ledgerId: who.ledgerId, accountId: who.cashId };
  }
  function post(who: Person, body: Record<string, unknown>) {
    return request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({ date, record: record(who), ...body });
  }
  async function lend(who: Person, name: string, amount: number) {
    const response = await post(who, { counterparty: { name }, kind: 'LEND', amount }).expect(201);
    return (response.body as CreateDebtEntryResponse).counterparty.id;
  }
  async function borrow(who: Person, name: string, amount: number) {
    const response = await post(who, { counterparty: { name }, kind: 'BORROW', amount }).expect(
      201,
    );
    return (response.body as CreateDebtEntryResponse).counterparty.id;
  }
  async function repayment(who: Person, counterpartyId: string, amount: number) {
    const response = await post(who, {
      counterparty: { id: counterpartyId },
      kind: 'REPAYMENT',
      amount,
      settle: true,
    }).expect(201);
    const body = response.body as CreateDebtEntryResponse;
    expect(body.entries).toHaveLength(1);
    return body.entries[0]!;
  }
  async function transaction(who: Person, id: string): Promise<Transaction> {
    const response = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/transactions/${id}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Transaction;
  }
  async function cashBalance(who: Person): Promise<number> {
    const accounts = await listAccounts(app, who.token);
    return accounts.find((account) => account.id === who.cashId)!.balance;
  }
  async function entries(who: Person, counterpartyId: string): Promise<DebtEntry[]> {
    const response = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .set(auth(who.token))
      .expect(200);
    return (response.body as Paginated<DebtEntry>).items;
  }

  it('SC-H1 requires a ledger and account for every loan and repayment', async () => {
    const who = await person(app, 'me@example.com', 'Me');
    const counterpartyId = await lend(who, '房東', 9300);
    const debtActions = [
      { counterparty: { name: '小華' }, kind: 'LEND', amount: 9300 },
      { counterparty: { name: '阿明' }, kind: 'BORROW', amount: 9300 },
      { counterparty: { id: counterpartyId }, kind: 'REPAYMENT', amount: 100, settle: false },
    ];
    for (const action of debtActions) {
      for (const target of [null, { ledgerId: who.ledgerId }]) {
        const response = await post(who, { ...action, record: target }).expect(400);
        if (target !== null) expect(response.body).toMatchObject({ errorCode: 'ACCOUNT_REQUIRED' });
      }
    }
  });

  it('SC-H3/H4/H5/H6 records, recalculates, and withdraws collection differences', async () => {
    const who = await person(app, 'me@example.com', 'Me');
    const landlord = await lend(who, '房東', 9300);
    const paid = await repayment(who, landlord, 9000);
    expect(await cashBalance(who)).toBe(-300);
    expect(paid).toMatchObject({
      kind: 'COLLECT',
      delta: -9300,
      difference: { type: 'EXPENSE', amount: 300 },
    });
    expect((await transaction(who, paid.transactionId!)).amount).toBe(9300);
    const branchId = paid.difference!.transactionId;
    expect(await transaction(who, branchId)).toMatchObject({
      differenceOfId: paid.transactionId,
      amount: 300,
      type: 'EXPENSE',
    });
    expect((await getCounterparty(app, who, landlord)).balance).toBe(0);
    expect((await entries(who, landlord)).every((entry) => entry.kind !== 'SETTLEMENT')).toBe(true);
    const listing = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/transactions`)
      .set(auth(who.token))
      .expect(200);
    expect((listing.body as Paginated<Transaction>).items.some((row) => row.id === branchId)).toBe(
      false,
    );
    await request(server())
      .patch(`/api/ledgers/${who.ledgerId}/transactions/${branchId}`)
      .set(auth(who.token))
      .send({ amount: 1 })
      .expect(409);
    await request(server())
      .delete(`/api/ledgers/${who.ledgerId}/transactions/${branchId}`)
      .set(auth(who.token))
      .expect(409);

    for (const [amount, type, difference] of [
      [9100, 'EXPENSE', 200],
      [9500, 'INCOME', 200],
      [9300, null, null],
    ] as const) {
      const response = await request(server())
        .patch(`/api/debt-entries/${paid.id}`)
        .set(auth(who.token))
        .send({ amount })
        .expect(200);
      if (type === null) expect((response.body as DebtEntry).difference).toBeNull();
      else
        expect((response.body as DebtEntry).difference).toMatchObject({ type, amount: difference });
      expect((await getCounterparty(app, who, landlord)).balance).toBe(0);
      expect(await cashBalance(who)).toBe(type === 'EXPENSE' ? -200 : type === 'INCOME' ? 200 : 0);
    }
    await request(server()).delete(`/api/debt-entries/${paid.id}`).set(auth(who.token)).expect(204);
    expect((await getCounterparty(app, who, landlord)).balance).toBe(9300);
    expect(await cashBalance(who)).toBe(-9300);
    await request(server())
      .get(`/api/ledgers/${who.ledgerId}/transactions/${branchId}`)
      .set(auth(who.token))
      .expect(404);
  });

  it('SC-H4 also covers overcollection and a repayment I make', async () => {
    const who = await person(app, 'me@example.com', 'Me');
    const beforeCollection = await cashBalance(who);
    const ade = await lend(who, '阿德', 10000);
    expect((await repayment(who, ade, 10500)).difference).toMatchObject({
      type: 'INCOME',
      amount: 500,
    });
    expect(await cashBalance(who)).toBe(beforeCollection + 500);

    const creditor = await borrow(who, '債主', 10000);
    const beforeRepayment = await cashBalance(who);
    expect((await repayment(who, creditor, 9500)).difference).toMatchObject({
      type: 'INCOME',
      amount: 500,
    });
    expect(await cashBalance(who)).toBe(beforeRepayment - 9500);

    const creditor2 = await borrow(who, '另一位', 10000);
    const beforeOverpayment = await cashBalance(who);
    expect((await repayment(who, creditor2, 10500)).difference).toMatchObject({
      type: 'EXPENSE',
      amount: 500,
    });
    expect(await cashBalance(who)).toBe(beforeOverpayment - 10500);
  });

  it('SC-H14 records bad debt without an account and withdraws it with forgiveness', async () => {
    const who = await person(app, 'me@example.com', 'Me');
    const ming = await lend(who, '明哥', 50000);
    const cashBeforeForgiveness = await cashBalance(who);
    await request(server())
      .post(`/api/counterparties/${ming}/forgive`)
      .set(auth(who.token))
      .send({})
      .expect(400);
    const response = await request(server())
      .post(`/api/counterparties/${ming}/forgive`)
      .set(auth(who.token))
      .send({ ledgerId: who.ledgerId })
      .expect(201);
    const forgiven = (response.body as CreateDebtEntryResponse).entries[0]!;
    expect(forgiven).toMatchObject({ kind: 'FORGIVE', delta: -50000 });
    expect(await transaction(who, forgiven.transactionId!)).toMatchObject({
      type: 'EXPENSE',
      amount: 50000,
      account: null,
      category: null,
    });
    expect(await cashBalance(who)).toBe(cashBeforeForgiveness);
    await request(server())
      .delete(`/api/ledgers/${who.ledgerId}/transactions/${forgiven.transactionId}`)
      .set(auth(who.token))
      .expect(409);
    await request(server())
      .delete(`/api/debt-entries/${forgiven.id}`)
      .set(auth(who.token))
      .expect(204);
    expect((await getCounterparty(app, who, ming)).balance).toBe(50000);
    expect(await cashBalance(who)).toBe(cashBeforeForgiveness);
  });

  it('SC-H7 mirrors a linked settlement and its withdrawal', async () => {
    const a = await person(app, 'a@example.com', 'A');
    const b = await person(app, 'b@example.com', 'B');
    const pair = await linkPair(app, a, b);
    await post(a, {
      counterparty: { id: pair.aCounterpartyId },
      kind: 'LEND',
      amount: 9300,
    }).expect(201);
    const loan = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'CREATE',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${loan.id}/accept`)
      .set(auth(b.token))
      .send({ record: null })
      .expect(400);
    await request(server())
      .post(`/api/debt-proposals/${loan.id}/accept`)
      .set(auth(b.token))
      .send({ record: record(b) })
      .expect(200);
    const paid = await repayment(a, pair.aCounterpartyId, 9000);
    const pending = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'CREATE' && proposal.entryKind === 'REPAY',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${pending.id}/accept`)
      .set(auth(b.token))
      .send({ record: record(b) })
      .expect(200);
    const mirrored = (await entries(b, pair.bCounterpartyId)).find(
      (entry) => entry.kind === 'REPAY',
    )!;
    expect(mirrored.difference).toMatchObject({ type: 'INCOME', amount: 300 });
    await request(server())
      .patch(`/api/debt-entries/${paid.id}`)
      .set(auth(a.token))
      .send({ amount: 9100 })
      .expect(200);
    const amendment = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'AMEND',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${amendment.id}/accept`)
      .set(auth(b.token))
      .send({})
      .expect(200);
    const changed = (await entries(b, pair.bCounterpartyId)).find(
      (entry) => entry.id === mirrored.id,
    )!;
    expect(changed.difference).toMatchObject({ type: 'INCOME', amount: 200 });
    expect(changed.delta).toBe(9300);
    await request(server()).delete(`/api/debt-entries/${paid.id}`).set(auth(a.token)).expect(204);
    const deletion = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'DELETE',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${deletion.id}/accept`)
      .set(auth(b.token))
      .send({})
      .expect(200);
    expect((await entries(b, pair.bCounterpartyId)).some((entry) => entry.id === mirrored.id)).toBe(
      false,
    );
  });

  it('SC-H14 mirrors forgiveness as income without an account', async () => {
    const a = await person(app, 'a@example.com', 'A');
    const b = await person(app, 'b@example.com', 'B');
    const pair = await linkPair(app, a, b);
    await post(a, {
      counterparty: { id: pair.aCounterpartyId },
      kind: 'LEND',
      amount: 50000,
    }).expect(201);
    const loan = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'CREATE',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${loan.id}/accept`)
      .set(auth(b.token))
      .send({ record: record(b) })
      .expect(200);
    await request(server())
      .post(`/api/counterparties/${pair.aCounterpartyId}/forgive`)
      .set(auth(a.token))
      .send({ ledgerId: a.ledgerId })
      .expect(201);
    const forgiveness = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'CREATE' && proposal.entryKind === 'FORGIVEN',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${forgiveness.id}/accept`)
      .set(auth(b.token))
      .send({})
      .expect(400);
    await request(server())
      .post(`/api/debt-proposals/${forgiveness.id}/accept`)
      .set(auth(b.token))
      .send({ record: { ledgerId: b.ledgerId, accountId: b.cashId } })
      .expect(400);
    await request(server())
      .post(`/api/debt-proposals/${forgiveness.id}/accept`)
      .set(auth(b.token))
      .send({ record: { ledgerId: b.ledgerId } })
      .expect(200);
    const received = (await entries(b, pair.bCounterpartyId)).find(
      (entry) => entry.kind === 'FORGIVEN',
    )!;
    expect(received.delta).toBe(50000);
    expect(await transaction(b, received.transactionId!)).toMatchObject({
      type: 'INCOME',
      amount: 50000,
      account: null,
      category: null,
    });
  });

  it('accepts forgiveness without a record when the recipient has no debt', async () => {
    const a = await person(app, 'a@example.com', 'A');
    const b = await person(app, 'b@example.com', 'B');
    const pair = await linkPair(app, a, b);
    await post(a, {
      counterparty: { id: pair.aCounterpartyId },
      kind: 'LEND',
      amount: 50000,
    }).expect(201);
    await request(server())
      .post(`/api/counterparties/${pair.aCounterpartyId}/forgive`)
      .set(auth(a.token))
      .send({ ledgerId: a.ledgerId })
      .expect(201);
    const forgiveness = (await proposals(app, b, 'incoming')).find(
      (proposal) => proposal.type === 'CREATE' && proposal.entryKind === 'FORGIVEN',
    )!;
    await request(server())
      .post(`/api/debt-proposals/${forgiveness.id}/accept`)
      .set(auth(b.token))
      .send({})
      .expect(200);
    expect(
      (await entries(b, pair.bCounterpartyId)).some((entry) => entry.kind === 'FORGIVEN'),
    ).toBe(false);
  });
});
