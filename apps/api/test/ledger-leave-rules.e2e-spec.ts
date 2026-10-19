import { INestApplication } from '@nestjs/common';
import type {
  Category,
  Counterparty,
  LedgerGroup,
  LedgerRemovalPreview,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import {
  auth,
  createCounterparty,
  getCounterparty,
  linkPair,
  person,
  type Person,
} from './linking-utils';

/**
 * 3k 退出後的規則（SC-K3、SC-K4、SC-K9、決策 204）：用 HTTP 驗證帳戶、存取與刪除。
 * 退出前提直接刪 LedgerMember，避免依賴另案的退出／合併端點；帳戶引用另由 Prisma 查驗。
 * 個人借還與分帳刻意使用無帳戶的形式，確保保護來自個人紀錄本身，而非帳戶引用。
 */
describe('Ledger leave rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => httpServer(app);
  const date = '2026-10-18T12:00:00.000Z';
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function scene() {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    for (const who of [bob, carol])
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(alice.token))
        .send({ email: who.email, role: 'EDITOR' })
        .expect(201);
    const people = await prisma.ledgerPerson.findMany({ where: { ledgerId } });
    const personId = (who: Person) => people.find((p) => p.userId === who.userId)!.id;
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(alice.token))
      .expect(200);
    return {
      alice,
      bob,
      carol,
      ledgerId,
      personId,
      categoryId: (categories.body as Category[])[0]!.id,
    };
  }
  type Scene = Awaited<ReturnType<typeof scene>>;
  const depart = (s: Scene, who: Person) =>
    prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: who.userId } },
    });
  const expense = (s: Scene, payer: Person, caller = s.alice) =>
    request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(caller.token))
      .send({
        type: 'EXPENSE',
        amount: 1000,
        date,
        categoryId: s.categoryId,
        payerPersonId: s.personId(payer),
        ...(payer.userId === caller.userId ? { accountId: caller.cashId } : {}),
      });
  const saved = (id: string) =>
    prisma.transaction.findUniqueOrThrow({
      where: { id },
      select: { accountId: true, toAccountId: true },
    });
  const removeMember = (s: Scene, target = s.bob, caller = s.alice) =>
    request(server())
      .delete(`/api/ledgers/${s.ledgerId}/members/${target.userId}`)
      .set(auth(caller.token));
  const preview = async (s: Scene) =>
    (
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/removal-preview`)
        .set(auth(s.alice.token))
        .expect(200)
    ).body as LedgerRemovalPreview;
  const remove = (s: Scene, withdrawDebts?: boolean) =>
    request(server())
      .delete(`/api/ledgers/${s.ledgerId}`)
      .query({ confirm: 'Trip', ...(withdrawDebts ? { withdrawDebts: true } : {}) })
      .set(auth(s.alice.token));

  it('SC-K4: creates and edits expenses for former payers without retaining or creating accounts', async () => {
    const s = await scene();
    const baseline = await listAccounts(app, s.bob.token);
    const old = (await expense(s, s.bob).expect(201)).body as Transaction;
    expect((await saved(old.id)).accountId).not.toBeNull();
    const own = (await expense(s, s.alice).expect(201)).body as Transaction;
    await depart(s, s.bob);
    const before = await listAccounts(app, s.bob.token);
    const created = (await expense(s, s.bob).expect(201)).body as Transaction;
    expect((await saved(created.id)).accountId).toBeNull();
    expect(await listAccounts(app, s.bob.token)).toEqual(before);
    // 刻意保留退出前的帳戶引用以驗證 UPDATE 會清除；清除後回到原本餘額。
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${old.id}`)
      .set(auth(s.alice.token))
      .send({ title: '改名稱' })
      .expect(200);
    expect((await saved(old.id)).accountId).toBeNull();
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${own.id}`)
      .set(auth(s.alice.token))
      .send({ payerPersonId: s.personId(s.bob) })
      .expect(200);
    expect((await saved(own.id)).accountId).toBeNull();
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${created.id}`)
      .set(auth(s.alice.token))
      .send({ payerPersonId: s.personId(s.carol) })
      .expect(200);
    const carolTemporary = await prisma.account.findFirstOrThrow({
      where: { userId: s.carol.userId, isTemporary: true },
    });
    expect((await saved(created.id)).accountId).toBe(carolTemporary.id);
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${old.id}`)
      .set(auth(s.alice.token))
      .send({ payerPersonId: s.personId(s.alice), accountId: s.alice.cashId })
      .expect(200);
    expect((await saved(old.id)).accountId).toBe(s.alice.cashId);
    expect(await listAccounts(app, s.bob.token)).toEqual(baseline);
  });

  it.each(['from', 'to'] as const)(
    'SC-K4: former %s side has no account on settlement create or update',
    async (side) => {
      const s = await scene();
      const baseline = await listAccounts(app, s.bob.token);
      const payload =
        side === 'from'
          ? {
              fromPersonId: s.personId(s.bob),
              toPersonId: s.personId(s.alice),
              toAccountId: s.alice.cashId,
            }
          : {
              fromPersonId: s.personId(s.alice),
              toPersonId: s.personId(s.bob),
              fromAccountId: s.alice.cashId,
            };
      const post = () =>
        request(server())
          .post(`/api/ledgers/${s.ledgerId}/settlements`)
          .set(auth(s.alice.token))
          .send({ ...payload, amount: 200, date });
      const old = (await post().expect(201)).body as Transaction;
      await depart(s, s.bob);
      const before = await listAccounts(app, s.bob.token);
      const created = (await post().expect(201)).body as Transaction;
      const expected =
        side === 'from'
          ? { accountId: null, toAccountId: s.alice.cashId }
          : { accountId: s.alice.cashId, toAccountId: null };
      expect(await saved(created.id)).toEqual(expected);
      expect(await listAccounts(app, s.bob.token)).toEqual(before);
      await request(server())
        .patch(`/api/ledgers/${s.ledgerId}/settlements/${old.settlement!.id}`)
        .set(auth(s.alice.token))
        .send({ amount: 300 })
        .expect(200);
      expect(await saved(old.id)).toEqual(expected);
      expect(await listAccounts(app, s.bob.token)).toEqual(baseline);
    },
  );

  it('SC-K4: another active member still receives a temporary account opposite a former member', async () => {
    const s = await scene();
    await depart(s, s.bob);
    const before = await listAccounts(app, s.bob.token);
    const created = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/settlements`)
      .set(auth(s.alice.token))
      .send({ fromPersonId: s.personId(s.bob), toPersonId: s.personId(s.carol), amount: 100, date })
      .expect(201);
    const carolTemporary = await prisma.account.findFirstOrThrow({
      where: { userId: s.carol.userId, isTemporary: true },
    });
    expect(await saved((created.body as Transaction).id)).toEqual({
      accountId: null,
      toAccountId: carolTemporary.id,
    });
    expect(await listAccounts(app, s.bob.token)).toEqual(before);
  });

  it('SC-K3: former members cannot open details, transactions or summaries and have no ledger debt parts', async () => {
    const s = await scene();
    const { bCounterpartyId } = await linkPair(app, s.alice, s.bob);
    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.alice.token))
      .send({
        type: 'EXPENSE',
        amount: 1000,
        date,
        categoryId: s.categoryId,
        accountId: s.alice.cashId,
        ledgerSplit: {
          method: 'EQUAL',
          shares: [{ personId: s.personId(s.alice) }, { personId: s.personId(s.bob) }],
        },
      })
      .expect(201);
    expect((await getCounterparty(app, s.bob, bCounterpartyId)).ledgerParts).toHaveLength(1);
    await depart(s, s.bob);
    for (const suffix of ['', '/transactions', '/settlement-summary', '/settlements'])
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}${suffix}`)
        .set(auth(s.bob.token))
        .expect(404);
    for (const query of [{}, { unpointed: true }, { hasSettlements: true }]) {
      const res = await request(server())
        .get('/api/ledger-groups')
        .query(query)
        .set(auth(s.bob.token))
        .expect(200);
      expect((res.body as LedgerGroup[]).map((g) => g.ledger.id)).not.toContain(s.ledgerId);
    }
    expect((await getCounterparty(app, s.bob, bCounterpartyId)).ledgerParts).toEqual([]);
    const res = await request(server())
      .get('/api/counterparties')
      .set(auth(s.bob.token))
      .expect(200);
    for (const cp of (res.body as Paginated<Counterparty>).items)
      expect(cp.ledgerParts.map((p) => p.ledgerId)).not.toContain(s.ledgerId);
    await request(server())
      .get(`/api/ledgers/${s.ledgerId}/settlement-summary`)
      .set(auth(s.alice.token))
      .expect(200);
  });

  it.each(['cash', 'temporary', 'toAccount', 'deleted'] as const)(
    'SC-K9: account reference (%s) blocks removal and permits demotion to viewer',
    async (kind) => {
      const s = await scene();
      let id: string;
      if (kind === 'toAccount') {
        const res = await request(server())
          .post(`/api/ledgers/${s.ledgerId}/settlements`)
          .set(auth(s.bob.token))
          .send({
            fromPersonId: s.personId(s.alice),
            toPersonId: s.personId(s.bob),
            toAccountId: s.bob.cashId,
            amount: 100,
            date,
          })
          .expect(201);
        id = (res.body as Transaction).id;
      } else
        id = (
          (await expense(s, s.bob, kind === 'cash' ? s.bob : s.alice).expect(201))
            .body as Transaction
        ).id;
      if (kind === 'deleted')
        await request(server())
          .delete(`/api/ledgers/${s.ledgerId}/transactions/${id}`)
          .set(auth(s.alice.token))
          .expect(204);
      const before = await listAccounts(app, s.bob.token);
      const res = await removeMember(s).expect(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('MEMBER_HAS_TRANSACTIONS');
      await request(server())
        .patch(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.alice.token))
        .send({ role: 'VIEWER' })
        .expect(200);
      expect(await listAccounts(app, s.bob.token)).toEqual(before);
      expect(
        await prisma.ledgerMember.findUniqueOrThrow({
          where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: s.bob.userId } },
        }),
      ).toMatchObject({ role: 'VIEWER' });
    },
  );

  it.each(['debt', 'split'] as const)(
    'SC-K9: personal %s without accounts blocks removal; withdrawn records no longer block',
    async (kind) => {
      const s = await scene();
      const cp = await createCounterparty(app, s.bob, 'Ming');
      if (kind === 'debt')
        await request(server())
          .post('/api/debt-entries')
          .set(auth(s.bob.token))
          .send({
            counterparty: { id: cp.id },
            kind: 'LEND',
            amount: 100,
            date,
            record: { ledgerId: s.ledgerId, accountId: s.bob.cashId },
          })
          .expect(201);
      else
        await request(server())
          .post('/api/splits')
          .set(auth(s.bob.token))
          .send({
            ledgerId: s.ledgerId,
            type: 'EXPENSE',
            categoryId: s.categoryId,
            total: 100,
            date,
            payer: { counterpartyId: cp.id },
            method: 'EQUAL',
            participants: [{ counterpartyId: null }, { counterpartyId: cp.id }],
          })
          .expect(201);
      // 清掉帳戶以單獨驗證個人往來／分帳的保護，不讓帳戶分支先擋下。
      if (kind === 'debt')
        await prisma.transaction.updateMany({
          where: { ledgerId: s.ledgerId, creatorId: s.bob.userId },
          data: { accountId: null },
        });
      expect(
        await prisma.transaction.count({
          where: {
            ledgerId: s.ledgerId,
            OR: [{ account: { userId: s.bob.userId } }, { toAccount: { userId: s.bob.userId } }],
          },
        }),
      ).toBe(0);
      expect(((await removeMember(s).expect(409)).body as { errorCode: string }).errorCode).toBe(
        'MEMBER_HAS_TRANSACTIONS',
      );
      if (kind === 'debt') {
        const entry = await prisma.debtEntry.findFirstOrThrow({ where: { counterpartyId: cp.id } });
        await request(server())
          .delete(`/api/debt-entries/${entry.id}`)
          .set(auth(s.bob.token))
          .expect(204);
      } else {
        const split = await prisma.split.findFirstOrThrow({
          where: { ledgerId: s.ledgerId, ownerId: s.bob.userId },
        });
        await request(server())
          .delete(`/api/splits/${split.id}`)
          .set(auth(s.bob.token))
          .expect(204);
      }
      await removeMember(s).expect(204);
    },
  );

  it('SC-K9: empty members can be removed; self-removal always requires merge regardless of role', async () => {
    const s = await scene();
    for (const who of [s.alice, s.bob])
      expect(
        ((await removeMember(s, who, who).expect(409)).body as { errorCode: string }).errorCode,
      ).toBe('LEAVE_REQUIRES_MERGE');
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
      .set(auth(s.alice.token))
      .send({ role: 'VIEWER' })
      .expect(200);
    expect(
      ((await removeMember(s, s.bob, s.bob).expect(409)).body as { errorCode: string }).errorCode,
    ).toBe('LEAVE_REQUIRES_MERGE');
    await removeMember(s).expect(204);
    expect(
      await prisma.ledgerMember.count({ where: { ledgerId: s.ledgerId, userId: s.bob.userId } }),
    ).toBe(0);
  });

  it('decision 204: other members block first; another creator without their account does not block', async () => {
    const s = await scene();
    await expense(s, s.alice, s.bob).expect(201);
    expect((await preview(s)).delete).toEqual({ allowed: false, blockedBy: 'HAS_OTHER_MEMBERS' });
    expect(((await remove(s).expect(409)).body as { errorCode: string }).errorCode).toBe(
      'LEDGER_HAS_OTHER_MEMBERS',
    );
    await depart(s, s.bob);
    await depart(s, s.carol);
    expect((await preview(s)).delete).toEqual({ allowed: true, blockedBy: null });
    await remove(s).expect(204);
    expect(await prisma.ledger.count({ where: { id: s.ledgerId } })).toBe(0);
  });

  it('decision 204: a sole member withdraws personal debts before deleting a shared ledger', async () => {
    const s = await scene();
    await depart(s, s.bob);
    await depart(s, s.carol);
    const cp = await createCounterparty(app, s.alice, 'Ming');
    await request(server())
      .post('/api/debt-entries')
      .set(auth(s.alice.token))
      .send({
        counterparty: { id: cp.id },
        kind: 'LEND',
        amount: 100,
        date,
        record: { ledgerId: s.ledgerId, accountId: s.alice.cashId },
      })
      .expect(201);
    expect(await preview(s)).toMatchObject({
      delete: { allowed: true, blockedBy: null },
      withdrawsDebts: true,
    });
    expect(((await remove(s).expect(409)).body as { errorCode: string }).errorCode).toBe(
      'DEBT_WITHDRAWAL_REQUIRED',
    );
    await remove(s, true).expect(204);
    expect((await getCounterparty(app, s.alice, cp.id)).balance).toBe(0);
    const withdrawn = await prisma.debtEntry.findFirstOrThrow({ where: { counterpartyId: cp.id } });
    expect(withdrawn).toMatchObject({ transactionId: null, splitId: null });
    expect(withdrawn.deletedAt).toBeInstanceOf(Date);
  });
});
