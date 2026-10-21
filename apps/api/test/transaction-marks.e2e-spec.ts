import { performance } from 'node:perf_hooks';
import { INestApplication } from '@nestjs/common';
import type {
  Category,
  MarkedTransaction,
  Paginated,
  Split,
  Transaction,
  UpdateSplitResponse,
} from '@ledger/shared';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, person, type Person } from './linking-utils';

/**
 * 3l SC-N10、N11、N13：真實 HTTP 與專屬資料庫驗證標註隔離、排序分頁、搬移與合成列。
 * 只在設定同日期的建立順序、模擬退出與大量效能資料時直接使用 Prisma。
 */
describe('Transaction marks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const DAY = '2026-10-21T12:00:00.000Z';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function scene() {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', '小美');
    const homeId = await createSharedLedger(app, carol.token, '家用');
    await request(server())
      .post(`/api/ledgers/${homeId}/members`)
      .set(auth(carol.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    return { bob, carol, homeId };
  }

  async function expense(who: Person, ledgerId: string, title = '計程車', date = DAY) {
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(who.token))
      .query({ type: 'EXPENSE' })
      .expect(200);
    const response = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({
        type: 'EXPENSE',
        amount: 30000,
        date,
        title,
        accountId: who.cashId,
        categoryId: (categories.body as Category[])[0]!.id,
      })
      .expect(201);
    expect((response.body as Transaction).marked).toBe(false);
    return response.body as Transaction;
  }

  const markPath = (ledgerId: string, transactionId: string) =>
    `/api/ledgers/${ledgerId}/transactions/${transactionId}/mark`;
  const mark = (who: Person, ledgerId: string, transactionId: string) =>
    request(server()).put(markPath(ledgerId, transactionId)).set(auth(who.token)).expect(204);
  const unmark = (who: Person, ledgerId: string, transactionId: string) =>
    request(server()).delete(markPath(ledgerId, transactionId)).set(auth(who.token)).expect(204);
  async function marked(who: Person, query: Record<string, number> = {}) {
    const response = await request(server())
      .get('/api/transactions/marked')
      .set(auth(who.token))
      .query(query)
      .expect(200);
    return response.body as Paginated<MarkedTransaction>;
  }
  async function detail(who: Person, ledgerId: string, id: string) {
    const response = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions/${id}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Transaction;
  }

  it('SC-N10: marks and unmarks idempotently; each member sees only their own state', async () => {
    const { bob, carol, homeId } = await scene();
    const taxi = await expense(bob, homeId);
    await Promise.all([mark(bob, homeId, taxi.id), mark(bob, homeId, taxi.id)]);
    expect(await prisma.transactionMark.count()).toBe(1);
    expect((await detail(bob, homeId, taxi.id)).marked).toBe(true);
    expect((await detail(carol, homeId, taxi.id)).marked).toBe(false);
    for (const who of [bob, carol]) {
      const response = await request(server())
        .get(`/api/ledgers/${homeId}/transactions`)
        .set(auth(who.token))
        .expect(200);
      expect((response.body as Paginated<Transaction>).items[0]!.marked).toBe(who === bob);
    }
    await mark(carol, homeId, taxi.id);
    const updated = await request(server())
      .patch(`/api/ledgers/${homeId}/transactions/${taxi.id}`)
      .set(auth(bob.token))
      .send({ title: '計程車回家' })
      .expect(200);
    expect((updated.body as Transaction).marked).toBe(true);
    await unmark(bob, homeId, taxi.id);
    await unmark(bob, homeId, taxi.id);
    expect((await detail(bob, homeId, taxi.id)).marked).toBe(false);
    expect((await detail(carol, homeId, taxi.id)).marked).toBe(true);
    expect((await marked(bob)).items).toEqual([]);
    expect(await prisma.transactionMark.count()).toBe(1);
  });

  it('SC-N11: all current ledgers, own marks, stable date/creation/id order and pagination', async () => {
    const { bob, carol, homeId } = await scene();
    const expected: Transaction[] = [];
    for (let i = 0; i < 12; i++) {
      const transaction = await expense(
        bob,
        i % 2 ? homeId : bob.ledgerId,
        `標註 ${i}`,
        i < 2 ? '2026-10-20T12:00:00.000Z' : DAY,
      );
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          createdAt: new Date(
            `2026-10-21T12:00:${String(Math.floor(i / 2)).padStart(2, '0')}.000Z`,
          ),
        },
      });
      await mark(bob, i % 2 ? homeId : bob.ledgerId, transaction.id);
      expected.push(await detail(bob, i % 2 ? homeId : bob.ledgerId, transaction.id));
    }
    expected.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
    const deleted = await expense(bob, homeId, '已刪除');
    await mark(bob, homeId, deleted.id);
    await request(server())
      .delete(`/api/ledgers/${homeId}/transactions/${deleted.id}`)
      .set(auth(bob.token))
      .expect(204);
    const carolOnly = await expense(carol, homeId, '小美的標註');
    await mark(carol, homeId, carolOnly.id);
    const leftId = await createSharedLedger(app, carol.token, '已退出');
    await request(server())
      .post(`/api/ledgers/${leftId}/members`)
      .set(auth(carol.token))
      .send({ email: bob.email, role: 'VIEWER' })
      .expect(201);
    const left = await expense(carol, leftId);
    await mark(bob, leftId, left.id);
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: leftId, userId: bob.userId } },
    });

    const first = await marked(bob);
    expect(first).toMatchObject({ page: 1, limit: 10, total: 12 });
    expect(first.items.map((item) => item.id)).toEqual(
      expected.slice(0, 10).map((item) => item.id),
    );
    const second = await marked(bob, { page: 2, limit: 10 });
    expect(second.items.map((item) => item.id)).toEqual(expected.slice(10).map((item) => item.id));
    expect(second.total).toBe(12);
    const all = await marked(bob, { limit: 100 });
    expect(
      all.items.map((item) => {
        const transaction: Partial<MarkedTransaction> = { ...item };
        delete transaction.ledger;
        return transaction;
      }),
    ).toEqual(expected);
    expect(new Set(all.items.map((item) => item.ledger.id))).toEqual(
      new Set([homeId, bob.ledgerId]),
    );
    expect(await marked(bob, { page: 99, limit: 5 })).toMatchObject({
      items: [],
      page: 99,
      limit: 5,
      total: 12,
    });
    expect((await marked(carol)).items.map((item) => item.id)).toEqual([carolOnly.id]);
    expect(await prisma.transactionMark.count({ where: { userId: bob.userId } })).toBe(14);
  });

  it.each([{ limit: 101 }, { limit: 0 }, { limit: 1.5 }, { page: 0 }, { page: 1.5 }])(
    'rejects invalid pagination %j',
    async (query) => {
      const bob = await person(app, 'bob@example.com', 'Bob');
      await request(server())
        .get('/api/transactions/marked')
        .set(auth(bob.token))
        .query(query)
        .expect(400);
    },
  );

  it('allows viewers to mark and unmark archived ledgers', async () => {
    const { bob, carol, homeId } = await scene();
    const taxi = await expense(carol, homeId);
    await prisma.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId: homeId, userId: bob.userId } },
      data: { role: 'VIEWER' },
    });
    await request(server())
      .post(`/api/ledgers/${homeId}/archive`)
      .set(auth(carol.token))
      .expect(201);
    await mark(bob, homeId, taxi.id);
    expect((await marked(bob)).items[0]).toMatchObject({
      id: taxi.id,
      marked: true,
      account: null,
    });
    await unmark(bob, homeId, taxi.id);
    expect((await detail(bob, homeId, taxi.id)).marked).toBe(false);
  });

  it('SC-N13: moving a marked transaction retains the mark and changes the ledger name', async () => {
    const { bob, homeId } = await scene();
    const taxi = await expense(bob, bob.ledgerId);
    await mark(bob, bob.ledgerId, taxi.id);
    const source = await prisma.ledger.findUniqueOrThrow({ where: { id: bob.ledgerId } });
    await request(server())
      .post(`/api/ledgers/${bob.ledgerId}/leave`)
      .set(auth(bob.token))
      .send({
        deleteLedger: true,
        confirm: source.name,
        moves: [{ targetLedgerId: homeId, itemIds: [taxi.id] }],
      })
      .expect(204);
    expect((await detail(bob, homeId, taxi.id)).marked).toBe(true);
    expect((await marked(bob)).items).toMatchObject([
      { id: taxi.id, marked: true, ledger: { id: homeId, name: '家用' } },
    ]);
  });

  it('marks merged share and advance ids as one representative, with the combined amount', async () => {
    const { bob, carol, homeId } = await scene();
    const people = await prisma.ledgerPerson.findMany({ where: { ledgerId: homeId } });
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: homeId, type: 'EXPENSE' },
    });
    const response = await request(server())
      .post(`/api/ledgers/${homeId}/transactions`)
      .set(auth(bob.token))
      .send({
        type: 'EXPENSE',
        amount: 30000,
        date: DAY,
        title: '車資分帳',
        categoryId: category.id,
        accountId: bob.cashId,
        ledgerSplit: { method: 'EQUAL', shares: people.map(({ id }) => ({ personId: id })) },
      })
      .expect(201);
    const original = response.body as Transaction;
    await request(server())
      .post(`/api/ledgers/${homeId}/leave`)
      .set(auth(bob.token))
      .send({ targetLedgerId: bob.ledgerId, excludedItemIds: [] })
      .expect(204);
    const rows = await prisma.transaction.findMany({
      where: { ledgerId: bob.ledgerId, mergedFromId: original.id, deletedAt: null },
    });
    const share = rows.find((row) => row.type === 'EXPENSE')!;
    const advance = rows.find((row) => row.type === 'LEND')!;
    expect(share).toBeDefined();
    expect(advance).toBeDefined();
    await mark(bob, bob.ledgerId, share.id);
    await mark(bob, bob.ledgerId, advance.id);
    expect(
      await prisma.transactionMark.findMany({ select: { userId: true, transactionId: true } }),
    ).toEqual([{ userId: bob.userId, transactionId: share.id }]);
    const canonical = await detail(bob, bob.ledgerId, advance.id);
    expect(canonical).toMatchObject({
      id: share.id,
      marked: true,
      amount: 30000,
      merge: { share: 15000 },
    });
    const list = await request(server())
      .get(`/api/ledgers/${bob.ledgerId}/transactions`)
      .set(auth(bob.token))
      .expect(200);
    expect((list.body as Paginated<Transaction>).items).toEqual([canonical]);
    const marks = await marked(bob, { limit: 1 });
    expect(marks.total).toBe(1);
    expect(marks.items).toHaveLength(1);
    expect(marks.items[0]).toMatchObject({ ...canonical, ledger: { id: bob.ledgerId } });
    await unmark(bob, bob.ledgerId, advance.id);
    expect((await detail(bob, bob.ledgerId, share.id)).marked).toBe(false);
    expect((await detail(carol, homeId, original.id)).marked).toBe(false);
  });

  it('settlement creation, detail, edit, list and account assignment preserve each viewer mark', async () => {
    const { bob, carol, homeId } = await scene();
    const recipient = await prisma.ledgerPerson.findFirstOrThrow({
      where: { ledgerId: homeId, userId: carol.userId },
    });
    const created = await request(server())
      .post(`/api/ledgers/${homeId}/settlements`)
      .set(auth(bob.token))
      .send({ toPersonId: recipient.id, amount: 5000, date: DAY, fromAccountId: bob.cashId })
      .expect(201);
    const transaction = created.body as Transaction;
    expect(transaction.marked).toBe(false);
    await mark(bob, homeId, transaction.id);
    const edited = await request(server())
      .patch(`/api/ledgers/${homeId}/settlements/${transaction.settlement!.id}`)
      .set(auth(bob.token))
      .send({ note: '已付款' })
      .expect(200);
    expect((edited.body as Transaction).marked).toBe(true);
    const listed = await request(server())
      .get(`/api/ledgers/${homeId}/settlements`)
      .set(auth(bob.token))
      .expect(200);
    expect((listed.body as Paginated<Transaction>).items[0]!.marked).toBe(true);
    expect((await marked(bob)).items[0]).toMatchObject({
      ...(edited.body as Transaction),
      ledger: { id: homeId, name: '家用' },
    });
    await mark(carol, homeId, transaction.id);
    const assigned = await request(server())
      .put(`/api/ledgers/${homeId}/settlements/${transaction.settlement!.id}/account`)
      .set(auth(carol.token))
      .send({ accountId: carol.cashId })
      .expect(200);
    expect((assigned.body as Transaction).marked).toBe(true);
    expect((await detail(bob, homeId, transaction.id)).marked).toBe(true);
  });

  it('debt transactions carry viewer marks in details, lists and the marked list', async () => {
    const { bob, carol, homeId } = await scene();
    const counterparty = await createCounterparty(app, bob, '阿德');
    await request(server())
      .post('/api/debt-entries')
      .set(auth(bob.token))
      .send({
        counterparty: { id: counterparty.id },
        kind: 'LEND',
        amount: 10000,
        date: DAY,
        record: { ledgerId: homeId, accountId: bob.cashId },
      })
      .expect(201);
    const transaction = await prisma.transaction.findFirstOrThrow({
      where: { ledgerId: homeId, type: 'LEND' },
    });
    expect((await detail(bob, homeId, transaction.id)).marked).toBe(false);
    await mark(bob, homeId, transaction.id);
    await mark(carol, homeId, transaction.id);
    for (const who of [bob, carol]) {
      const view = await detail(who, homeId, transaction.id);
      expect(view.marked).toBe(true);
      expect(view.debt !== null).toBe(who === bob);
      const list = await request(server())
        .get(`/api/ledgers/${homeId}/transactions`)
        .set(auth(who.token))
        .expect(200);
      expect((list.body as Paginated<Transaction>).items).toEqual([view]);
      expect((await marked(who)).items).toEqual([
        { ...view, ledger: { id: homeId, name: '家用' } },
      ]);
    }
  });

  it('documents marked pagination and every transaction response field in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'jwt').build(),
    );
    expect(document.paths['/api/transactions/marked']?.get?.tags).toContain('transactions');
    const schema = document.components!.schemas!.MarkedTransactionDto;
    expect(schema).toHaveProperty('properties.marked');
    expect(schema).toHaveProperty('properties.ledger');
    expect(document.components!.schemas!.LedgerShareDto).toHaveProperty('properties.personId');
    expect(document.components!.schemas!.ShareDto).toHaveProperty('properties.person');
    expect(
      document.paths['/api/ledgers/{ledgerId}/transactions/{transactionId}/mark']?.put?.responses,
    ).toHaveProperty('204');
  });

  it('normalizes settlement branches to the repayment without changing detail ids', async () => {
    const { bob, carol, homeId } = await scene();
    const counterparty = await createCounterparty(app, bob, '阿德');
    for (const [kind, amount, settle] of [
      ['LEND', 10000, false],
      ['REPAYMENT', 9000, true],
    ] as const) {
      await request(server())
        .post('/api/debt-entries')
        .set(auth(bob.token))
        .send({
          counterparty: { id: counterparty.id },
          kind,
          amount,
          date: DAY,
          ...(settle ? { settle: true } : {}),
          record: { ledgerId: homeId, accountId: bob.cashId },
        })
        .expect(201);
    }
    const branch = await prisma.transaction.findFirstOrThrow({
      where: { ledgerId: homeId, differenceOfId: { not: null } },
    });
    for (const who of [bob, carol]) {
      await mark(who, homeId, branch.id);
      expect(await detail(who, homeId, branch.id)).toMatchObject({ id: branch.id, marked: true });
      expect((await detail(who, homeId, branch.differenceOfId!)).marked).toBe(true);
      expect((await marked(who)).items.map((item) => item.id)).toEqual([branch.differenceOfId]);
      expect(
        await prisma.transactionMark.findUnique({
          where: { userId_transactionId: { userId: who.userId, transactionId: branch.id } },
        }),
      ).toBeNull();
      await unmark(who, homeId, branch.id);
      expect((await detail(who, homeId, branch.differenceOfId!)).marked).toBe(false);
    }
  });

  it('normalizes personal split advances only for the owner and preserves marks after dissolution', async () => {
    const { bob, carol, homeId } = await scene();
    const counterparty = await createCounterparty(app, bob, '阿德');
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: homeId, type: 'EXPENSE' },
    });
    const input = {
      type: 'EXPENSE',
      ledgerId: homeId,
      categoryId: category.id,
      total: 20000,
      date: DAY,
      payer: null,
      accountId: bob.cashId,
      method: 'EQUAL',
      participants: [{ counterpartyId: null }, { counterpartyId: counterparty.id }],
    };
    const created = await request(server())
      .post('/api/splits')
      .set(auth(bob.token))
      .send(input)
      .expect(201);
    const split = created.body as Split;
    const rows = await prisma.transaction.findMany({ where: { splitId: split.id } });
    const share = rows.find((row) => row.type === 'EXPENSE')!;
    const advance = rows.find((row) => row.type === 'LEND')!;
    await mark(bob, homeId, advance.id);
    await mark(bob, homeId, share.id);
    await mark(carol, homeId, advance.id);
    expect(
      await prisma.transactionMark.findMany({
        where: { userId: bob.userId },
        select: { transactionId: true },
      }),
    ).toEqual([{ transactionId: share.id }]);
    expect(await detail(bob, homeId, advance.id)).toMatchObject({ id: advance.id, marked: true });
    expect((await detail(carol, homeId, share.id)).marked).toBe(false);
    expect((await marked(bob)).items.map((item) => item.id)).toEqual([share.id]);
    expect((await marked(carol)).items.map((item) => item.id)).toEqual([advance.id]);
    const ownerList = await request(server())
      .get(`/api/ledgers/${homeId}/transactions`)
      .set(auth(bob.token))
      .expect(200);
    expect((ownerList.body as Paginated<Transaction>).items).toMatchObject([
      { id: share.id, marked: true },
    ]);
    await unmark(bob, homeId, advance.id);
    expect((await detail(bob, homeId, share.id)).marked).toBe(false);
    expect((await detail(carol, homeId, advance.id)).marked).toBe(true);
    await mark(bob, homeId, advance.id);
    const dissolved = await request(server())
      .patch(`/api/splits/${split.id}`)
      .set(auth(bob.token))
      .send({ ...input, participants: [{ counterpartyId: null }] })
      .expect(200);
    expect((dissolved.body as UpdateSplitResponse).transaction).toMatchObject({
      id: share.id,
      marked: true,
    });
  });

  it('transaction account assignment keeps the caller mark', async () => {
    const { bob, carol, homeId } = await scene();
    const payer = await prisma.ledgerPerson.findFirstOrThrow({
      where: { ledgerId: homeId, userId: bob.userId },
    });
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: homeId, type: 'EXPENSE' },
    });
    const response = await request(server())
      .post(`/api/ledgers/${homeId}/transactions`)
      .set(auth(carol.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: DAY,
        categoryId: category.id,
        payerPersonId: payer.id,
      })
      .expect(201);
    const transaction = response.body as Transaction;
    await mark(bob, homeId, transaction.id);
    const assigned = await request(server())
      .put(`/api/ledgers/${homeId}/transactions/${transaction.id}/account`)
      .set(auth(bob.token))
      .send({ accountId: bob.cashId })
      .expect(200);
    expect(assigned.body as Transaction).toMatchObject({
      marked: true,
      accountPending: false,
      account: { id: bob.cashId },
    });
  });

  it('measures a 50-row page from 200 transactions with 20 marks', async () => {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: bob.ledgerId, type: 'EXPENSE' },
    });
    await prisma.transaction.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        ledgerId: bob.ledgerId,
        creatorId: bob.userId,
        accountId: bob.cashId,
        categoryId: category.id,
        type: 'EXPENSE' as const,
        amount: 100,
        date: new Date(DAY),
        title: `效能 ${i}`,
      })),
    });
    const rows = await prisma.transaction.findMany({
      where: { ledgerId: bob.ledgerId },
      orderBy: { id: 'desc' },
    });
    await prisma.transactionMark.createMany({
      data: rows.slice(0, 20).map(({ id }) => ({ userId: bob.userId, transactionId: id })),
    });
    const start = performance.now();
    const response = await request(server())
      .get(`/api/ledgers/${bob.ledgerId}/transactions`)
      .query({ limit: 50 })
      .set(auth(bob.token))
      .expect(200);
    console.info(
      `MARKS_PERFORMANCE_200_ROWS_20_MARKS_LIMIT_50_MS=${(performance.now() - start).toFixed(2)}`,
    );
    expect((response.body as Paginated<Transaction>).items).toHaveLength(50);
    expect((response.body as Paginated<Transaction>).total).toBe(200);
  });
});
