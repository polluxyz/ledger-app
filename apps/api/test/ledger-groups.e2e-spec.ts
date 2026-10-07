import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  SettlementSummary,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, linkPair, person, type Person } from './linking-utils';

/** 同一份交易逐步驗金額、指向與退出，避免借還總額和結清摘要各走不同算法。 */
describe('Ledger groups and counterparty totals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const day = '2026-10-06T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function members(owner: Person, ledgerId: string): Promise<LedgerPerson[]> {
    const response = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(owner.token))
      .expect(200);
    return response.body as LedgerPerson[];
  }

  async function groups(who: Person, unpointed = false): Promise<LedgerGroup[]> {
    const response = await request(server())
      .get('/api/ledger-groups')
      .query(unpointed ? { unpointed: 'true' } : {})
      .set(auth(who.token))
      .expect(200);
    return response.body as LedgerGroup[];
  }

  async function counterparties(who: Person, nonZero = false): Promise<Paginated<Counterparty>> {
    const response = await request(server())
      .get('/api/counterparties')
      .query(nonZero ? { nonZero: 'true' } : {})
      .set(auth(who.token))
      .expect(200);
    return response.body as Paginated<Counterparty>;
  }

  async function counterparty(who: Person, id: string): Promise<Counterparty> {
    const response = await request(server())
      .get(`/api/counterparties/${id}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Counterparty;
  }

  it('keeps summary, automatic and explicit pointers, totals, settlement, and exit in sync', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const linked = await linkPair(app, alice, bob, '明哥');
    const landlord = await createCounterparty(app, alice, '房東');
    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    const eveLedgerId = await createSharedLedger(app, eve.token, '別人的帳本');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const [alicePerson, bobPerson] = await members(alice, ledgerId);
    const category = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);
    const categoryId = (category.body as Array<{ id: string }>)[0]!.id;
    await request(server())
      .post('/api/debt-entries')
      .set(auth(alice.token))
      .send({
        counterparty: { id: linked.aCounterpartyId },
        kind: 'LEND',
        amount: 50000,
        date: day,
        record: null,
      })
      .expect(201);
    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 102400,
        date: day,
        categoryId,
        accountId: alice.cashId,
        title: '住宿',
        ledgerSplit: {
          method: 'EQUAL',
          shares: [{ personId: alicePerson!.id }, { personId: bobPerson!.id }],
        },
      })
      .expect(201);

    const summaryResponse = await request(server())
      .get(`/api/ledgers/${ledgerId}/settlement-summary`)
      .set(auth(alice.token))
      .expect(200);
    const suggestion = (summaryResponse.body as SettlementSummary).suggestions;
    expect(suggestion).toEqual([
      { fromPersonId: bobPerson!.id, toPersonId: alicePerson!.id, amount: 51200 },
    ]);
    const linkedView = await counterparty(alice, linked.aCounterpartyId);
    expect(linkedView.balance).toBe(50000);
    expect(linkedView.ledgerParts).toEqual([
      {
        ledgerId,
        ledgerName: '花蓮三日',
        personId: bobPerson!.id,
        personName: 'Bob',
        amount: 51200,
        left: false,
      },
    ]);
    expect(linkedView.totalBalance).toBe(101200);
    expect(
      (await groups(alice))[0]!.people.find(({ person }) => person.id === bobPerson!.id)?.amount,
    ).toBe(51200);
    expect(await groups(alice, true)).toEqual([]);
    expect((await groups(alice)).some(({ ledger }) => ledger.id === eveLedgerId)).toBe(false);
    expect(
      (await counterparties(eve)).items.every(({ ledgerParts }) => ledgerParts.length === 0),
    ).toBe(true);

    const pointerUrl = `/api/ledgers/${ledgerId}/people/${bobPerson!.id}/pointer`;
    const source = await createCounterparty(app, alice, '待合併');
    await request(server())
      .put(pointerUrl)
      .set(auth(alice.token))
      .send({ counterpartyId: source.id })
      .expect(200);
    await request(server())
      .post(`/api/counterparties/${linked.aCounterpartyId}/merge`)
      .set(auth(alice.token))
      .send({ sourceId: source.id })
      .expect(200);
    expect((await counterparty(alice, linked.aCounterpartyId)).ledgerParts[0]!.amount).toBe(51200);
    await request(server())
      .put(pointerUrl)
      .set(auth(alice.token))
      .send({ counterpartyId: null })
      .expect(200);
    expect((await counterparty(alice, linked.aCounterpartyId)).ledgerParts).toEqual([]);
    expect((await groups(alice, true))[0]!.people[0]!.amount).toBe(51200);
    await request(server())
      .put(pointerUrl)
      .set(auth(alice.token))
      .send({ counterpartyId: landlord.id })
      .expect(200);
    expect((await counterparty(alice, landlord.id)).totalBalance).toBe(51200);
    expect(await groups(alice, true)).toEqual([]);
    await request(server()).delete(pointerUrl).set(auth(alice.token)).expect(200);
    expect((await counterparty(alice, linked.aCounterpartyId)).totalBalance).toBe(101200);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(bob.token))
      .send({ toPersonId: alicePerson!.id, amount: 51200, date: day, fromAccountId: bob.cashId })
      .expect(201);
    expect((await counterparty(alice, linked.aCounterpartyId)).totalBalance).toBe(50000);
    expect((await counterparty(alice, linked.aCounterpartyId)).ledgerParts).toEqual([]);
    expect((await counterparties(alice, true)).items.map(({ id }) => id)).toContain(
      linked.aCounterpartyId,
    );
  });

  it('keeps an outstanding amount after the caller leaves and excludes settled counterparties', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const ledgerId = await createSharedLedger(app, bob.token, '旅行');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(bob.token))
      .send({ email: alice.email, role: 'EDITOR' })
      .expect(201);
    const listed = await members(alice, ledgerId);
    const alicePerson = listed.find((person) => person.userId === alice.userId)!;
    const bobPerson = listed.find((person) => person.userId === bob.userId)!;
    const target = await createCounterparty(app, alice, '旅伴');
    const zero = await createCounterparty(app, alice, '兩清');
    await request(server())
      .put(`/api/ledgers/${ledgerId}/people/${bobPerson.id}/pointer`)
      .set(auth(alice.token))
      .send({ counterpartyId: target.id })
      .expect(200);
    const category = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);
    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 102400,
        date: day,
        categoryId: (category.body as Array<{ id: string }>)[0]!.id,
        accountId: alice.cashId,
        title: '住宿',
        ledgerSplit: {
          method: 'EQUAL',
          shares: [{ personId: alicePerson.id }, { personId: bobPerson.id }],
        },
      })
      .expect(201);
    await request(server())
      .delete(`/api/counterparties/${target.id}`)
      .set(auth(alice.token))
      .expect(204);
    expect((await groups(alice, true))[0]!.people[0]!.person.id).toBe(bobPerson.id);
    const replacement = await createCounterparty(app, alice, '旅伴二');
    await request(server())
      .put(`/api/ledgers/${ledgerId}/people/${bobPerson.id}/pointer`)
      .set(auth(alice.token))
      .send({ counterpartyId: replacement.id })
      .expect(200);
    await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
      .set(auth(alice.token))
      .expect(204);
    expect((await counterparty(alice, replacement.id)).ledgerParts[0]).toMatchObject({
      amount: 51200,
      left: true,
    });
    expect((await groups(alice))[0]!.ledger).toMatchObject({ id: ledgerId, left: true });
    expect((await groups(alice))[0]!.people[0]!.amount).toBe(51200);
    const list = await counterparties(alice, true);
    expect(list.items.map(({ id }) => id)).toContain(replacement.id);
    expect(list.items.map(({ id }) => id)).not.toContain(zero.id);
    expect(list.total).toBe(1);
  });

  it('records a one-shot response time for ten shared ledgers with twenty transactions each', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    for (let ledgerNumber = 0; ledgerNumber < 10; ledgerNumber += 1) {
      const ledgerId = await createSharedLedger(app, alice.token, `效能帳本 ${ledgerNumber}`);
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(alice.token))
        .send({ email: bob.email, role: 'EDITOR' })
        .expect(201);
      const [alicePerson, bobPerson] = await members(alice, ledgerId);
      await prisma.$transaction(
        Array.from({ length: 20 }, () =>
          prisma.transaction.create({
            data: {
              ledgerId,
              creatorId: alice.userId,
              type: 'EXPENSE',
              amount: 200,
              date: new Date(day),
              payerPersonId: alicePerson!.id,
              ledgerSplit: {
                create: {
                  method: 'AMOUNT',
                  shares: {
                    create: [
                      { personId: alicePerson!.id, share: 100, sortOrder: 0 },
                      { personId: bobPerson!.id, share: 100, sortOrder: 1 },
                    ],
                  },
                },
              },
            },
          }),
        ),
      );
    }
    const started = performance.now();
    await counterparties(alice);
    // 只記一次實測值，避免 CI 主機負載變動讓功能測試不穩定。
    console.info(
      `GET /counterparties (10 ledgers x 20 transactions): ${Math.round(performance.now() - started)} ms`,
    );
  }, 60000);
});
