import { INestApplication } from '@nestjs/common';
import type {
  Category,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  DebtEntry,
  Paginated,
  Transaction,
  UpdateDebtEntryRequest,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, getCounterparty, linkPair, person, proposals, type Person } from './linking-utils';

/** 3i SC-I1～I7：以真實 HTTP 與資料庫驗證交易標記、分支搬帳戶、餘額與連動提議。 */
describe('Debt entry edit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const DAY = '2026-10-15T12:00:00.000Z';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function category(who: Person, type: 'EXPENSE' | 'INCOME', ledgerId = who.ledgerId) {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  async function bank(who: Person) {
    const res = await request(server())
      .post('/api/accounts')
      .set(auth(who.token))
      .send({ name: '銀行' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function create(who: Person, overrides: Partial<CreateDebtEntryRequest> = {}) {
    return request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({
        counterparty: { name: '明哥' },
        kind: 'LEND',
        amount: 50000,
        date: DAY,
        record: { ledgerId: who.ledgerId, accountId: who.cashId },
        ...overrides,
      });
  }

  function patch(who: Person, entry: DebtEntry, input: UpdateDebtEntryRequest) {
    return request(server())
      .patch(`/api/debt-entries/${entry.id}`)
      .set(auth(who.token))
      .send(input);
  }

  async function entries(who: Person, counterpartyId: string) {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<DebtEntry>).items;
  }

  async function transaction(who: Person, entry: DebtEntry) {
    const res = await request(server())
      .get(`/api/ledgers/${entry.recorded!.ledgerId}/transactions/${entry.transactionId!}`)
      .set(auth(who.token))
      .expect(200);
    return res.body as Transaction;
  }

  it('SC-I1: moves repayment and its difference to bank, preserving debt and both account balances', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bankId = await bank(alice);
    const lent = (await create(alice, { amount: 9300 }).expect(201))
      .body as CreateDebtEntryResponse;
    const repaid = (
      await create(alice, {
        counterparty: { id: lent.counterparty.id },
        kind: 'REPAYMENT',
        amount: 9000,
        settle: true,
      }).expect(201)
    ).body as CreateDebtEntryResponse;
    const entry = repaid.entries[0]!;
    expect(entry.difference).toMatchObject({ type: 'EXPENSE', amount: 300 });
    const before = await listAccounts(app, alice.token);
    const proposalCount = await prisma.debtProposal.count();

    const res = await patch(alice, entry, { accountId: bankId }).expect(200);
    expect((res.body as DebtEntry).recorded?.accountId).toBe(bankId);
    const rows = await prisma.transaction.findMany({
      where: { OR: [{ id: entry.transactionId! }, { differenceOfId: entry.transactionId! }] },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.accountId === bankId)).toBe(true);
    const after = await listAccounts(app, alice.token);
    for (const [id, change] of [
      [alice.cashId, -9000],
      [bankId, 9000],
    ] as const) {
      expect(
        after.find((a) => a.id === id)!.balance - before.find((a) => a.id === id)!.balance,
      ).toBe(change);
    }
    expect(after.find((a) => a.id === alice.cashId)!.balance).toBe(-9300);
    expect(after.find((a) => a.id === bankId)!.balance).toBe(9000);
    expect((await getCounterparty(app, alice, lent.counterparty.id)).balance).toBe(0);
    expect(await prisma.debtProposal.count()).toBe(proposalCount);
  });

  it('SC-I2: rejects temporary and foreign accounts without changing repayment or its branch', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const lent = (await create(alice, { amount: 9300 }).expect(201))
      .body as CreateDebtEntryResponse;
    const repaid = (
      await create(alice, {
        counterparty: { id: lent.counterparty.id },
        kind: 'REPAYMENT',
        amount: 9000,
        settle: true,
      }).expect(201)
    ).body as CreateDebtEntryResponse;
    const entry = repaid.entries[0]!;
    const temporaryId = (await listAccounts(app, alice.token)).find((a) => a.isTemporary)!.id;
    const before = await prisma.transaction.findMany({ orderBy: { id: 'asc' } });
    for (const [accountId, status, errorCode] of [
      [temporaryId, 400, 'TEMPORARY_ACCOUNT_NOT_SELECTABLE'],
      [bob.cashId, 404, 'NOT_FOUND'],
    ] as const) {
      const res = await patch(alice, entry, { accountId, title: '不該寫入' }).expect(status);
      expect(res.body).toMatchObject({ errorCode });
      expect(await prisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    }
  });

  it.each([
    ['LEND', 'EXPENSE'],
    ['BORROW', 'INCOME'],
    ['COLLECT', 'INCOME'],
    ['REPAY', 'EXPENSE'],
  ] as const)(
    'SC-I3: %s accepts only %s labels, clears them, and preserves type and balances',
    async (kind, categoryType) => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      let entry: DebtEntry;
      if (kind === 'COLLECT' || kind === 'REPAY') {
        const initial = (
          await create(alice, { kind: kind === 'COLLECT' ? 'LEND' : 'BORROW' }).expect(201)
        ).body as CreateDebtEntryResponse;
        entry = (
          (
            await create(alice, {
              counterparty: { id: initial.counterparty.id },
              kind: 'REPAYMENT',
              amount: 10000,
            }).expect(201)
          ).body as CreateDebtEntryResponse
        ).entries[0]!;
      } else {
        entry = ((await create(alice, { kind }).expect(201)).body as CreateDebtEntryResponse)
          .entries[0]!;
      }
      const good = await category(alice, categoryType);
      const bad = await category(alice, categoryType === 'EXPENSE' ? 'INCOME' : 'EXPENSE');
      const otherLedger = await createSharedLedger(app, alice.token, '另一本');
      const foreign = await category(alice, categoryType, otherLedger);
      const before = await listAccounts(app, alice.token);
      const debtBefore = await getCounterparty(app, alice, entry.counterpartyId);
      const updated = await patch(alice, entry, { categoryId: good }).expect(200);
      expect((updated.body as DebtEntry).recorded?.categoryId).toBe(good);
      expect(await transaction(alice, entry)).toMatchObject({ type: kind, category: { id: good } });
      expect((await patch(alice, entry, { categoryId: bad }).expect(400)).body).toMatchObject({
        errorCode: 'CATEGORY_TYPE_MISMATCH',
      });
      await patch(alice, entry, { categoryId: foreign }).expect(404);
      expect((await transaction(alice, entry)).category?.id).toBe(good);
      await patch(alice, entry, { categoryId: null }).expect(200);
      expect((await transaction(alice, entry)).category).toBeNull();
      expect(await listAccounts(app, alice.token)).toEqual(before);
      expect((await getCounterparty(app, alice, entry.counterpartyId)).balance).toBe(
        debtBefore.balance,
      );
    },
  );

  it('SC-I4: stores and clears title, rejects over 100 characters and invalid identifiers', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const entry = ((await create(alice).expect(201)).body as CreateDebtEntryResponse).entries[0]!;
    const updated = await patch(alice, entry, { title: '押金' }).expect(200);
    expect((updated.body as DebtEntry).recorded?.title).toBe('押金');
    expect((await transaction(alice, entry)).title).toBe('押金');
    await patch(alice, entry, { title: '名'.repeat(101) }).expect(400);
    await patch(alice, entry, { accountId: 'invalid' }).expect(400);
    await patch(alice, entry, { categoryId: 'invalid' }).expect(400);
    await request(server())
      .patch(`/api/debt-entries/${entry.id}`)
      .set(auth(alice.token))
      .send({ accountId: null })
      .expect(400);
    await patch(alice, entry, { title: null }).expect(200);
    expect((await transaction(alice, entry)).title).toBeNull();
    await create(alice, { title: '名'.repeat(101) }).expect(400);
  });

  it('SC-I5: local fields leave a linked peer unchanged and amount still proposes an amendment', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const pair = await linkPair(app, alice, bob);
    const bankId = await bank(alice);
    const entry = (
      (await create(alice, { counterparty: { id: pair.aCounterpartyId } }).expect(201))
        .body as CreateDebtEntryResponse
    ).entries[0]!;
    const proposal = (await proposals(app, bob, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${proposal.id}/accept`)
      .set(auth(bob.token))
      .send({ record: { ledgerId: bob.ledgerId, accountId: bob.cashId } })
      .expect(200);
    const theirBefore = await entries(bob, pair.bCounterpartyId);
    const theirTransactions = await prisma.transaction.findMany({
      where: { creatorId: bob.userId },
    });
    const expense = await category(alice, 'EXPENSE');
    const updated = await patch(alice, entry, {
      title: '押金',
      accountId: bankId,
      categoryId: expense,
      note: '自己的備註',
    }).expect(200);
    expect((updated.body as DebtEntry).sync).toBe('SYNCED');
    expect(await proposals(app, bob, 'incoming', 'PENDING')).toHaveLength(0);
    expect(await entries(bob, pair.bCounterpartyId)).toEqual(theirBefore);
    expect(await prisma.transaction.findMany({ where: { creatorId: bob.userId } })).toEqual(
      theirTransactions,
    );
    await patch(alice, entry, { amount: 51000, title: '新的押金' }).expect(200);
    expect(await proposals(app, bob, 'incoming', 'PENDING')).toEqual([
      expect.objectContaining({ type: 'AMEND', amount: 51000 }),
    ]);
  });

  it('SC-I5: local fields do not replace a pending create proposal', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const pair = await linkPair(app, alice, bob);
    const entry = (
      (await create(alice, { counterparty: { id: pair.aCounterpartyId } }).expect(201))
        .body as CreateDebtEntryResponse
    ).entries[0]!;
    const before = await proposals(app, bob, 'incoming', 'PENDING');
    const res = await patch(alice, entry, { title: '押金', note: '本地' }).expect(200);
    expect((res.body as DebtEntry).sync).toBe(entry.sync);
    expect(await proposals(app, bob, 'incoming', 'PENDING')).toEqual(before);
  });

  it.each([
    ['LEND', 'EXPENSE'],
    ['BORROW', 'INCOME'],
  ] as const)(
    'SC-I6: creates %s with title and category and rolls back wrong direction',
    async (kind, categoryType) => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const categoryId = await category(alice, categoryType);
      const entry = (
        (await create(alice, { kind, title: '押金', categoryId }).expect(201))
          .body as CreateDebtEntryResponse
      ).entries[0]!;
      expect(entry.recorded).toEqual({
        ledgerId: alice.ledgerId,
        accountId: alice.cashId,
        title: '押金',
        categoryId,
        categoryIcon: (
          await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
            select: { icon: true },
          })
        ).icon,
      });
      expect(await transaction(alice, entry)).toMatchObject({
        type: kind,
        title: '押金',
        category: { id: categoryId },
      });
      const count = await prisma.debtEntry.count();
      const wrong = await category(alice, categoryType === 'EXPENSE' ? 'INCOME' : 'EXPENSE');
      expect((await create(alice, { kind, categoryId: wrong }).expect(400)).body).toMatchObject({
        errorCode: 'CATEGORY_TYPE_MISMATCH',
      });
      expect(await prisma.debtEntry.count()).toBe(count);
    },
  );

  it.each([
    ['LEND', 'COLLECT', 'INCOME'],
    ['BORROW', 'REPAY', 'EXPENSE'],
  ] as const)(
    'SC-I6: resolves repayment from %s to %s and labels only repayment',
    async (initialKind, kind, categoryType) => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const lent = (await create(alice, { kind: initialKind, amount: 9300 }).expect(201))
        .body as CreateDebtEntryResponse;
      const categoryId = await category(alice, categoryType);
      const wrong = await category(alice, categoryType === 'EXPENSE' ? 'INCOME' : 'EXPENSE');
      const input: Partial<CreateDebtEntryRequest> = {
        counterparty: { id: lent.counterparty.id },
        kind: 'REPAYMENT',
        amount: 9000,
        settle: true,
        title: '結清',
      };
      expect((await create(alice, { ...input, categoryId: wrong }).expect(400)).body).toMatchObject(
        { errorCode: 'CATEGORY_TYPE_MISMATCH' },
      );
      expect((await getCounterparty(app, alice, lent.counterparty.id)).balance).toBe(
        initialKind === 'LEND' ? 9300 : -9300,
      );
      const repaid = (await create(alice, { ...input, categoryId }).expect(201))
        .body as CreateDebtEntryResponse;
      const entry = repaid.entries[0]!;
      expect(entry.kind).toBe(kind);
      expect(entry.recorded?.categoryId).toBe(categoryId);
      expect(await transaction(alice, entry)).toMatchObject({
        type: kind,
        category: { id: categoryId },
      });
      const branch = await prisma.transaction.findUniqueOrThrow({
        where: { differenceOfId: entry.transactionId! },
      });
      expect(branch.categoryId).toBeNull();
      expect(branch.amount).toBe(300);
      expect(repaid.counterparty.balance).toBe(0);
    },
  );

  it('SC-I7: lists recorded on ordinary, split, forgiveness and legacy entries, including history', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const lent = (await create(alice).expect(201)).body as CreateDebtEntryResponse;
    const counterpartyId = lent.counterparty.id;
    const categoryId = await category(alice, 'EXPENSE');
    await request(server())
      .post('/api/splits')
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        ledgerId: alice.ledgerId,
        categoryId,
        total: 10000,
        date: DAY,
        title: '晚餐',
        payer: null,
        accountId: alice.cashId,
        method: 'EQUAL',
        participants: [{ counterpartyId: null }, { counterpartyId }],
      })
      .expect(201);
    await prisma.debtEntry.create({
      data: { counterpartyId, kind: 'LEND', delta: 100, date: new Date(DAY), transactionId: null },
    });
    await request(server())
      .post(`/api/counterparties/${counterpartyId}/forgive`)
      .set(auth(alice.token))
      .send({ ledgerId: alice.ledgerId })
      .expect(201);
    const rows = await entries(alice, counterpartyId);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toHaveProperty('recorded');
      const tx =
        row.transactionId === null
          ? null
          : await prisma.transaction.findUniqueOrThrow({
              where: { id: row.transactionId },
              select: {
                ledgerId: true,
                accountId: true,
                title: true,
                categoryId: true,
                category: { select: { icon: true } },
              },
            });
      expect(row.recorded).toEqual(
        tx === null
          ? null
          : {
              ledgerId: tx.ledgerId,
              accountId: tx.accountId,
              title: tx.title,
              categoryId: tx.categoryId,
              categoryIcon: tx.category?.icon ?? null,
            },
      );
    }
    expect(rows.find((r) => r.splitId !== null)?.recorded).toMatchObject({
      ledgerId: alice.ledgerId,
      accountId: alice.cashId,
      title: '晚餐',
    });
    expect(rows.find((r) => r.transactionId === null)?.recorded).toBeNull();
    expect(rows.find((r) => r.kind === 'FORGIVE')?.recorded?.accountId).toBeNull();
    for (const row of rows.filter(
      (r) => r.splitId !== null || r.transactionId === null || r.kind === 'FORGIVE',
    )) {
      const res = await patch(alice, row, { title: '不可改' }).expect(409);
      expect(res.body).toMatchObject({
        errorCode: row.splitId !== null ? 'SPLIT_ENTRY_READ_ONLY' : 'DEBT_ENTRY_NOT_EDITABLE',
      });
    }
    const history = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .query({ section: 'history' })
      .set(auth(alice.token))
      .expect(200);
    expect((history.body as Paginated<DebtEntry>).items.length).toBeGreaterThan(0);
    expect(
      (history.body as Paginated<DebtEntry>).items.every((row) => Object.hasOwn(row, 'recorded')),
    ).toBe(true);
  });
});
