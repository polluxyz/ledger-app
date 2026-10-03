/** 3c 分帳端到端測試：實際資料庫驗證份額、往來、提議、互轉與列表分頁。 */
import { INestApplication } from '@nestjs/common';
import type { CreateSplitRequest, Paginated, Split, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import {
  auth,
  createCounterparty,
  linkPair,
  person,
  proposals,
  type Person,
} from './linking-utils';

describe('Splits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const day = '2026-10-03T12:00:00.000Z';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function category(who: Person, type: 'EXPENSE' | 'INCOME' = 'EXPENSE'): Promise<string> {
    const result = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/categories`)
      .query({ type })
      .set(auth(who.token))
      .expect(200);
    return (result.body as Array<{ id: string }>)[0]!.id;
  }
  async function body(
    who: Person,
    others: string[],
    overrides: Partial<CreateSplitRequest> = {},
  ): Promise<CreateSplitRequest> {
    const type = overrides.type ?? 'EXPENSE';
    return {
      type,
      ledgerId: who.ledgerId,
      categoryId: await category(who, type),
      total: 300000,
      date: day,
      title: '晚餐',
      payer: null,
      accountId: who.cashId,
      method: 'EQUAL',
      participants: [
        { counterpartyId: null },
        ...others.map((counterpartyId) => ({ counterpartyId })),
      ],
      ...overrides,
    };
  }
  const create = (who: Person, input: CreateSplitRequest) =>
    request(server()).post('/api/splits').set(auth(who.token)).send(input);
  async function list(who: Person): Promise<Paginated<Transaction>> {
    const result = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/transactions`)
      .set(auth(who.token))
      .expect(200);
    return result.body as Paginated<Transaction>;
  }

  it('SC-S1: my expense share, three advances, and full account movement', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ids = await Promise.all(
      ['小明', '小華', '阿美'].map(async (name) => (await createCounterparty(app, alice, name)).id),
    );
    const input = await body(alice, ids);
    const result = await create(alice, input).expect(201);
    const split = result.body as Split;
    expect(split.total).toBe(300000);
    expect(split.participants.map((p) => p.share)).toEqual([75000, 75000, 75000, 75000]);
    const txs = await prisma.transaction.findMany({ where: { splitId: split.id } });
    expect(txs.map((tx) => [tx.type, tx.amount]).sort()).toEqual(
      [
        ['EXPENSE', 75000],
        ['LEND', 75000],
        ['LEND', 75000],
        ['LEND', 75000],
      ].sort(),
    );
    expect(
      await prisma.debtEntry.count({ where: { splitId: split.id, kind: 'PAID_FOR_THEM' } }),
    ).toBe(3);
    expect(
      txs.filter((tx) => tx.accountId === alice.cashId).reduce((sum, tx) => sum + tx.amount, 0),
    ).toBe(300000);
    expect((await list(alice)).items[0]?.split?.counterparts).toHaveLength(3);
  });

  it('SC-S2: another payer records only my expense and debt', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const hua = await createCounterparty(app, alice, '小華');
    const mei = await createCounterparty(app, alice, '阿美');
    const split = (
      await create(
        alice,
        await body(alice, [ming.id, hua.id, mei.id], {
          total: 320000,
          payer: { counterpartyId: ming.id },
          accountId: undefined,
        }),
      ).expect(201)
    ).body as Split;
    expect(split.payerEntryId).not.toBeNull();
    expect(split.participants.map((p) => p.share)).toEqual([80000, 80000, 80000, 80000]);
    expect(await prisma.transaction.count({ where: { splitId: split.id } })).toBe(1);
    expect(await prisma.debtEntry.count({ where: { splitId: split.id } })).toBe(1);
    expect(
      (await prisma.transaction.findFirstOrThrow({ where: { splitId: split.id } })).accountId,
    ).toBeNull();
    expect((await list(alice)).items[0]?.split?.counterparts).toHaveLength(1);
  });

  it('SC-S3 and S4: income split and receipt by another payer', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const split = (
      await create(alice, await body(alice, [ming.id], { type: 'INCOME', total: 300000 })).expect(
        201,
      )
    ).body as Split;
    expect((await prisma.debtEntry.findFirstOrThrow({ where: { splitId: split.id } })).kind).toBe(
      'RECEIVED_FOR_THEM',
    );
    expect(
      (await prisma.transaction.findMany({ where: { splitId: split.id } }))
        .map((tx) => tx.type)
        .sort(),
    ).toEqual(['BORROW', 'INCOME']);
    const received = (
      await create(
        alice,
        await body(alice, [], {
          type: 'INCOME',
          total: 50000,
          payer: { counterpartyId: ming.id },
          accountId: undefined,
        }),
      ).expect(201)
    ).body as Split;
    expect(
      (await prisma.debtEntry.findFirstOrThrow({ where: { splitId: received.id } })).kind,
    ).toBe('RECEIVED_FOR_ME');
    expect(
      (await prisma.transaction.findFirstOrThrow({ where: { splitId: received.id } })).type,
    ).toBe('INCOME');
  });

  it('SC-S6: invalid sums and participant combinations leave no rows', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const cases: Array<[Partial<CreateSplitRequest>, string]> = [
      [
        {
          method: 'AMOUNT',
          participants: [
            { counterpartyId: null, amount: 100 },
            { counterpartyId: ming.id, amount: 100 },
          ],
        },
        'SPLIT_SUM_MISMATCH',
      ],
      [
        {
          method: 'RATIO',
          participants: [
            { counterpartyId: null, ratio: 1000 },
            { counterpartyId: ming.id, ratio: 1000 },
          ],
        },
        'SPLIT_SUM_MISMATCH',
      ],
      [
        {
          payer: { counterpartyId: ming.id },
          accountId: undefined,
          participants: [{ counterpartyId: ming.id }],
        },
        'SPLIT_WITHOUT_ME',
      ],
      [{ participants: [{ counterpartyId: null }] }, 'SPLIT_NOT_NEEDED'],
    ];
    for (const [override, code] of cases) {
      const result = await create(alice, await body(alice, [ming.id], override)).expect(400);
      expect((result.body as { errorCode: string }).errorCode).toBe(code);
    }
    expect(await prisma.split.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('SC-S7 and S8: mirrored proposals require the right record shape', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await person(app, 'ming@example.com', 'Ming');
    const { aCounterpartyId } = await linkPair(app, alice, ming);
    await create(alice, await body(alice, [aCounterpartyId])).expect(201);
    const proposal = (await proposals(app, ming, 'incoming', 'PENDING'))[0]!;
    expect(proposal.entryKind).toBe('PAID_FOR_ME');
    expect(proposal.title).toBe('晚餐');
    const route = `/api/debt-proposals/${proposal.id}/accept`;
    await request(server())
      .post(route)
      .set(auth(ming.token))
      .send({ record: null, categoryId: await category(ming) })
      .expect(400);
    await request(server())
      .post(route)
      .set(auth(ming.token))
      .send({
        record: { ledgerId: ming.ledgerId, accountId: ming.cashId },
        categoryId: await category(ming),
      })
      .expect(400);
    await request(server())
      .post(route)
      .set(auth(ming.token))
      .send({ record: { ledgerId: ming.ledgerId }, categoryId: await category(ming) })
      .expect(200);
    expect(
      (
        await prisma.debtEntry.findFirstOrThrow({
          where: { counterparty: { ownerId: ming.userId } },
        })
      ).kind,
    ).toBe('PAID_FOR_ME');
    const reverse = (
      await create(
        alice,
        await body(alice, [], { payer: { counterpartyId: aCounterpartyId }, accountId: undefined }),
      ).expect(201)
    ).body as Split;
    expect(reverse.payerEntryId).not.toBeNull();
    const outgoing = (await proposals(app, ming, 'incoming', 'PENDING'))[0]!;
    expect(outgoing.entryKind).toBe('PAID_FOR_THEM');
    await request(server())
      .post(`/api/debt-proposals/${outgoing.id}/accept`)
      .set(auth(ming.token))
      .send({ record: null })
      .expect(200);
  });

  it('paired split entries send AMEND and DELETE with their title', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await person(app, 'ming@example.com', 'Ming');
    const { aCounterpartyId } = await linkPair(app, alice, ming);
    const input = await body(alice, [aCounterpartyId]);
    const split = (await create(alice, input).expect(201)).body as Split;
    expect((await list(alice)).items[0]?.split?.counterparts[0]?.sync).toBe('PENDING');
    const first = (await proposals(app, ming, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${first.id}/accept`)
      .set(auth(ming.token))
      .send({ record: { ledgerId: ming.ledgerId }, categoryId: await category(ming) })
      .expect(200);
    expect((await list(alice)).items[0]?.split?.counterparts[0]?.sync).toBe('SYNCED');
    await request(server())
      .patch(`/api/splits/${split.id}`)
      .set(auth(alice.token))
      .send({
        ...input,
        method: 'AMOUNT',
        participants: [
          { counterpartyId: null, amount: 100000 },
          { counterpartyId: aCounterpartyId, amount: 200000 },
        ],
      })
      .expect(200);
    const amend = (await proposals(app, ming, 'incoming', 'PENDING'))[0]!;
    expect(amend).toMatchObject({ type: 'AMEND', amount: 200000, title: '晚餐' });
    await request(server())
      .post(`/api/debt-proposals/${amend.id}/accept`)
      .set(auth(ming.token))
      .send({})
      .expect(200);
    await request(server()).delete(`/api/splits/${split.id}`).set(auth(alice.token)).expect(204);
    const deletion = (await proposals(app, ming, 'incoming', 'PENDING'))[0]!;
    expect(deletion).toMatchObject({ type: 'DELETE', title: '晚餐' });
  });

  it('SC-S9 and S10: modifying shares and payer reconciles entries', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ids = await Promise.all(
      ['小明', '小華', '阿美'].map(async (name) => (await createCounterparty(app, alice, name)).id),
    );
    const initial = await body(alice, ids);
    const split = (await create(alice, initial).expect(201)).body as Split;
    const changed = await body(alice, ids.slice(0, 2), {
      method: 'AMOUNT',
      participants: [
        { counterpartyId: null, amount: 100000 },
        { counterpartyId: ids[0]!, amount: 100000 },
        { counterpartyId: ids[1]!, amount: 100000 },
      ],
    });
    await request(server())
      .patch(`/api/splits/${split.id}`)
      .set(auth(alice.token))
      .send(changed)
      .expect(200);
    expect(await prisma.debtEntry.count({ where: { splitId: split.id, deletedAt: null } })).toBe(2);
    expect(
      await prisma.debtEntry.count({ where: { splitId: split.id, deletedAt: { not: null } } }),
    ).toBe(1);
    const otherPayer = await body(alice, ids.slice(0, 2), {
      payer: { counterpartyId: ids[0]! },
      accountId: undefined,
    });
    await request(server())
      .patch(`/api/splits/${split.id}`)
      .set(auth(alice.token))
      .send(otherPayer)
      .expect(200);
    const alive = await prisma.debtEntry.findMany({
      where: { splitId: split.id, deletedAt: null },
    });
    expect(alive).toHaveLength(1);
    expect(alive[0]!.kind).toBe('PAID_FOR_ME');
  });

  it('SC-S11: general transaction converts to split and a single share dissolves it', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const input = await body(alice, [ming.id]);
    const ordinary = await request(server())
      .post(`/api/ledgers/${alice.ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 300000,
        date: day,
        title: '晚餐',
        categoryId: input.categoryId,
        accountId: alice.cashId,
      })
      .expect(201);
    const originalId = (ordinary.body as Transaction).id;
    const split = (await create(alice, { ...input, fromTransactionId: originalId }).expect(201))
      .body as Split;
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: originalId } })).deletedAt,
    ).not.toBeNull();
    const result = await request(server())
      .patch(`/api/splits/${split.id}`)
      .set(auth(alice.token))
      .send({ ...input, note: '改成自己付', participants: [{ counterpartyId: null }] })
      .expect(200);
    // 解散後它是一般交易，分帳的備註要搬過來（合併驗收時補上，plan §6）。
    expect(result.body).toMatchObject({
      split: null,
      transaction: { amount: 300000, note: '改成自己付', split: null },
    });
    expect(await prisma.debtEntry.count({ where: { splitId: split.id, deletedAt: null } })).toBe(0);
  });

  it('SC-S12 and S13: delete is atomic and child records are read-only', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const split = (await create(alice, await body(alice, [ming.id])).expect(201)).body as Split;
    const tx = await prisma.transaction.findFirstOrThrow({ where: { splitId: split.id } });
    const entry = await prisma.debtEntry.findFirstOrThrow({ where: { splitId: split.id } });
    for (const method of ['patch', 'delete'] as const) {
      const result = await request(server())
        [method](`/api/ledgers/${alice.ledgerId}/transactions/${tx.id}`)
        .set(auth(alice.token))
        .send(method === 'patch' ? { amount: 1 } : undefined)
        .expect(409);
      expect((result.body as { errorCode: string }).errorCode).toBe('SPLIT_TRANSACTION_READ_ONLY');
    }
    const patch = await request(server())
      .patch(`/api/debt-entries/${entry.id}`)
      .set(auth(alice.token))
      .send({ amount: 1 })
      .expect(409);
    expect((patch.body as { errorCode: string }).errorCode).toBe('SPLIT_ENTRY_READ_ONLY');
    await request(server())
      .post('/api/debt-entries')
      .set(auth(alice.token))
      .send({
        kind: 'PAID_FOR_ME',
        counterparty: { id: ming.id },
        amount: 1,
        date: day,
        record: { ledgerId: alice.ledgerId },
        categoryId: await category(alice),
      })
      .expect(400);
    await request(server()).delete(`/api/splits/${split.id}`).set(auth(alice.token)).expect(204);
    expect(await prisma.transaction.count({ where: { splitId: split.id, deletedAt: null } })).toBe(
      0,
    );
    expect(await prisma.debtEntry.count({ where: { splitId: split.id, deletedAt: null } })).toBe(0);
  });

  it('SC-S14: 21 splits count as 21 rows and page two holds exactly one', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const input = await body(alice, [ming.id]);
    for (let index = 0; index < 21; index++)
      await create(alice, { ...input, title: `晚餐 ${index}` }).expect(201);
    const page = await request(server())
      .get(`/api/ledgers/${alice.ledgerId}/transactions`)
      .query({ page: 2, limit: 20, type: 'EXPENSE', categoryId: input.categoryId })
      .set(auth(alice.token))
      .expect(200);
    expect((page.body as Paginated<Transaction>).total).toBe(21);
    expect((page.body as Paginated<Transaction>).items).toHaveLength(1);
  });

  it('SC-S17 and S18: concurrent entries serialize; transaction title is bounded', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const input = await body(alice, [ming.id], { total: 200 });
    // 一次送 8 筆：只送 2 筆時，死結（外鍵的共享鎖 → FOR UPDATE）只在 CI 偶爾撞到，本機重現不了。
    const CONCURRENT = 8;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => create(alice, input)),
    );
    expect(results.map((result) => result.status)).toEqual(Array(CONCURRENT).fill(201));
    expect(
      (
        await prisma.debtEntry.aggregate({
          where: { counterpartyId: ming.id, deletedAt: null },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(100 * CONCURRENT);
    const bad = await request(server())
      .post(`/api/ledgers/${alice.ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 1,
        date: day,
        title: 'x'.repeat(101),
        categoryId: input.categoryId,
        accountId: alice.cashId,
      })
      .expect(400);
    expect((bad.body as { errorCode: string }).errorCode).toBe('VALIDATION_FAILED');
    const normal = await request(server())
      .post(`/api/ledgers/${alice.ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 1,
        date: day,
        categoryId: input.categoryId,
        accountId: alice.cashId,
      })
      .expect(201);
    expect((normal.body as Transaction).title).toBeNull();
  });

  it('merging two participants combines their shares and active debt entry', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await person(app, 'ming@example.com', 'Ming');
    const { aCounterpartyId: target } = await linkPair(app, alice, ming);
    const source = await createCounterparty(app, alice, '舊小明');
    const split = (await create(alice, await body(alice, [target, source.id])).expect(201))
      .body as Split;
    await request(server())
      .post(`/api/counterparties/${target}/merge`)
      .set(auth(alice.token))
      .send({ sourceId: source.id })
      .expect(200);
    const updated = (
      await request(server()).get(`/api/splits/${split.id}`).set(auth(alice.token)).expect(200)
    ).body as Split;
    expect(updated.participants).toHaveLength(2);
    expect(
      updated.participants.find((participant) => participant.counterpartyId === target)?.share,
    ).toBe(200000);
    const active = await prisma.debtEntry.findMany({
      where: { splitId: split.id, deletedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ counterpartyId: target, delta: 200000 });
  });

  it('an active split blocks counterparty deletion; deleting the split releases it', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const ming = await createCounterparty(app, alice, '小明');
    const split = (await create(alice, await body(alice, [ming.id])).expect(201)).body as Split;
    const blocked = await request(server())
      .delete(`/api/counterparties/${ming.id}`)
      .set(auth(alice.token))
      .expect(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe('COUNTERPARTY_HAS_ENTRIES');
    await request(server()).delete(`/api/splits/${split.id}`).set(auth(alice.token)).expect(204);
    await request(server())
      .delete(`/api/counterparties/${ming.id}`)
      .set(auth(alice.token))
      .expect(204);
  });

  it('another ledger editor cannot change the owner share transaction', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const shared = await createSharedLedger(app, alice.token);
    await request(server())
      .post(`/api/ledgers/${shared}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const ming = await createCounterparty(app, alice, '小明');
    const categories = await request(server())
      .get(`/api/ledgers/${shared}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;
    const split = (
      await create(alice, await body(alice, [ming.id], { ledgerId: shared, categoryId })).expect(
        201,
      )
    ).body as Split;
    const ownShare = await prisma.transaction.findFirstOrThrow({
      where: { splitId: split.id, type: 'EXPENSE' },
    });
    await request(server())
      .patch(`/api/ledgers/${shared}/transactions/${ownShare.id}`)
      .set(auth(bob.token))
      .send({ amount: 1 })
      .expect(409);
    await request(server())
      .delete(`/api/ledgers/${shared}/transactions/${ownShare.id}`)
      .set(auth(bob.token))
      .expect(409);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: ownShare.id } })).amount,
    ).toBe(150000);
  });
});
