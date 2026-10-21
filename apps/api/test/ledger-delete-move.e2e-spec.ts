import { INestApplication } from '@nestjs/common';
import type {
  Category,
  CreateDebtEntryResponse,
  LedgerLeavePreview,
  LeaveRequest,
  Paginated,
  Split,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { LedgersService } from '../src/ledgers/ledgers.service';
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

/** 3l SC-N1～N6、N14：旅行基金走真實 HTTP／PostgreSQL，另注入一步失敗驗證整筆回滾。 */
describe('Personal ledger deletion with moves (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const DAY = '2026-10-21T12:00:00.000Z';
  const TRAVEL = '旅行基金';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function category(who: Person, ledgerId: string, name = '機票訂金') {
    return (
      await request(server())
        .post(`/api/ledgers/${ledgerId}/categories`)
        .set(auth(who.token))
        .send({ name, type: 'EXPENSE', icon: 'travel' })
        .expect(201)
    ).body as Category;
  }
  async function account(who: Person, name: string, initialBalance = 0) {
    return (
      (
        await request(server())
          .post('/api/accounts')
          .set(auth(who.token))
          .send({ name, initialBalance })
          .expect(201)
      ).body as { id: string }
    ).id;
  }
  async function scene(linked = false) {
    const me = await person(app, 'me@example.com', '我');
    const mei = await person(app, 'mei@example.com', '小美');
    // 以有期初餘額的現金重現 §1：轉出及借出後恰好剩 $10,000。
    me.cashId = await account(me, '旅行現金', 1300000);
    const cardId = await account(me, '信用卡');
    const savingsId = await account(me, '旅行帳戶');
    const travelId = (
      (
        await request(server())
          .post('/api/ledgers')
          .set(auth(me.token))
          .send({ name: TRAVEL, kind: 'PERSONAL' })
          .expect(201)
      ).body as { id: string }
    ).id;
    await request(server())
      .patch(`/api/ledgers/${me.ledgerId}`)
      .set(auth(me.token))
      .send({ name: '日常' })
      .expect(200);
    const homeId = await createSharedLedger(app, mei.token, '家用');
    await request(server())
      .post(`/api/ledgers/${homeId}/members`)
      .set(auth(mei.token))
      .send({ email: me.email, role: 'EDITOR' })
      .expect(201);
    const ticketCategory = await category(me, travelId);
    const ticket = (
      await request(server())
        .post(`/api/ledgers/${travelId}/transactions`)
        .set(auth(me.token))
        .send({
          type: 'EXPENSE',
          amount: 500000,
          date: DAY,
          title: '機票訂金',
          categoryId: ticketCategory.id,
          accountId: cardId,
        })
        .expect(201)
    ).body as Transaction;
    const transfer = (
      await request(server())
        .post(`/api/ledgers/${travelId}/transactions`)
        .set(auth(me.token))
        .send({
          type: 'TRANSFER',
          amount: 200000,
          date: DAY,
          title: '存入',
          accountId: me.cashId,
          toAccountId: savingsId,
        })
        .expect(201)
    ).body as Transaction;
    const ade = linked ? await person(app, 'ade@example.com', '阿德') : null;
    const cpId = ade
      ? (await linkPair(app, me, ade, '阿德')).aCounterpartyId
      : (await createCounterparty(app, me, '阿德')).id;
    const loan = (
      await request(server())
        .post('/api/debt-entries')
        .set(auth(me.token))
        .send({
          counterparty: { id: cpId },
          kind: 'LEND',
          amount: 100000,
          date: DAY,
          title: '借給阿德',
          record: { ledgerId: travelId, accountId: me.cashId },
        })
        .expect(201)
    ).body as CreateDebtEntryResponse;
    if (ade) {
      const incoming = (await proposals(app, ade, 'incoming', 'PENDING'))[0]!;
      await request(server())
        .post(`/api/debt-proposals/${incoming.id}/accept`)
        .set(auth(ade.token))
        .send({ record: { ledgerId: ade.ledgerId, accountId: ade.cashId } })
        .expect(200);
    }
    return {
      me,
      mei,
      ade,
      travelId,
      homeId,
      cardId,
      savingsId,
      ticket,
      transfer,
      loan: loan.entries[0]!,
      cpId,
      ticketCategory,
    };
  }
  type Scene = Awaited<ReturnType<typeof scene>>;
  const body = (moves: NonNullable<LeaveRequest['moves']>, confirm = TRAVEL): LeaveRequest => ({
    deleteLedger: true,
    moves,
    confirm,
  });
  const preview = (s: Scene, input: LeaveRequest) =>
    request(server())
      .post(`/api/ledgers/${s.travelId}/leave-preview`)
      .set(auth(s.me.token))
      .send(input);
  const execute = (s: Scene, input: LeaveRequest) =>
    request(server()).post(`/api/ledgers/${s.travelId}/leave`).set(auth(s.me.token)).send(input);
  const allIds = (s: Scene) => [s.ticket.id, s.transfer.id, s.loan.transactionId!];
  async function snapshot() {
    return {
      ledgers: await prisma.ledger.findMany({ orderBy: { id: 'asc' } }),
      transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      splits: await prisma.split.findMany({ orderBy: { id: 'asc' } }),
      categories: await prisma.category.findMany({ orderBy: { id: 'asc' } }),
      entries: await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } }),
      merges: await prisma.ledgerMerge.findMany({ orderBy: { id: 'asc' } }),
      proposals: await prisma.debtProposal.findMany({ orderBy: { id: 'asc' } }),
    };
  }
  async function expectCategoriesBelong() {
    const rows = await prisma.transaction.findMany({ include: { category: true } });
    for (const t of rows) if (t.category) expect(t.category.ledgerId).toBe(t.ledgerId);
    for (const split of await prisma.split.findMany({ include: { category: true } }))
      expect(split.category.ledgerId).toBe(split.ledgerId);
  }

  it('SC-N1：3 筆搬到日常，id、金額、帳戶、日期、建立時間不變，借還仍可修改', async () => {
    const s = await scene();
    const before = await listAccounts(app, s.me.token);
    const original = await prisma.transaction.findMany({
      where: { ledgerId: s.travelId },
      orderBy: { id: 'asc' },
    });
    const cpBefore = await getCounterparty(app, s.me, s.cpId);
    const input = body([{ targetLedgerId: s.me.ledgerId, itemIds: allIds(s) }]);
    const p = (await preview(s, input).expect(200)).body as LedgerLeavePreview;
    expect(p.accounts).toEqual([]);
    expect(p.withdrawals).toEqual([]);
    expect(p.carryOvers).toEqual([]);
    expect(p.items).toHaveLength(3);
    await execute(s, input).expect(204);
    expect(await listAccounts(app, s.me.token)).toEqual(before);
    expect((await getCounterparty(app, s.me, s.cpId)).balance).toBe(cpBefore.balance);
    const moved = await prisma.transaction.findMany({
      where: { id: { in: allIds(s) } },
      orderBy: { id: 'asc' },
    });
    expect(moved).toHaveLength(3);
    for (const [i, t] of moved.entries())
      expect(t).toMatchObject({
        ...original[i]!,
        ledgerId: s.me.ledgerId,
        categoryId: t.categoryId,
        updatedAt: t.updatedAt,
      });
    expect(await prisma.ledgerMerge.count()).toBe(0);
    await request(server())
      .patch(`/api/debt-entries/${s.loan.id}`)
      .set(auth(s.me.token))
      .send({ title: '改名後的借款', amount: 110000, date: '2026-10-22T12:00:00.000Z' })
      .expect(200);
    expect((await getCounterparty(app, s.me, s.cpId)).balance).toBe(110000);
    await request(server()).get(`/api/ledgers/${s.travelId}`).set(auth(s.me.token)).expect(404);
    await expectCategoriesBelong();
  });

  it('SC-N2：分兩組搬，小美看得到存入與付款人、看不到背後往來，帳戶與結清摘要不變', async () => {
    const s = await scene();
    const meiBefore = await listAccounts(app, s.mei.token);
    const summaryBefore = (
      await request(server())
        .get(`/api/ledgers/${s.homeId}/settlement-summary`)
        .set(auth(s.mei.token))
        .expect(200)
    ).body as unknown;
    await execute(
      s,
      body([
        { targetLedgerId: s.homeId, itemIds: [s.transfer.id, s.loan.transactionId!] },
        { targetLedgerId: s.me.ledgerId, itemIds: [s.ticket.id] },
      ]),
    ).expect(204);
    expect(await listAccounts(app, s.mei.token)).toEqual(meiBefore);
    expect(
      (
        await request(server())
          .get(`/api/ledgers/${s.homeId}/settlement-summary`)
          .set(auth(s.mei.token))
          .expect(200)
      ).body,
    ).toEqual(summaryBefore);
    const list = (
      await request(server())
        .get(`/api/ledgers/${s.homeId}/transactions`)
        .set(auth(s.mei.token))
        .expect(200)
    ).body as Paginated<Transaction>;
    // 協調者確認沿用 3b 決策 13：交易可見、背後往來不可見；SC-N7 的衝突斷言由總控處理。
    expect(list.items.map((t) => t.id)).toEqual(
      expect.arrayContaining([s.transfer.id, s.loan.transactionId!]),
    );
    const transfer = list.items.find((t) => t.id === s.transfer.id)!;
    expect(transfer.creator.id).toBe(s.me.userId);
    expect(transfer.ledgerSplit).toBeNull();
    expect(list.items.find((t) => t.id === s.loan.transactionId!)!.debt).toBeNull();
    const otherView = (
      await request(server())
        .get(`/api/ledgers/${s.homeId}/transactions/${s.loan.transactionId!}`)
        .set(auth(s.mei.token))
        .expect(200)
    ).body as Transaction;
    expect(otherView.debt).toBeNull();
    await request(server())
      .get(`/api/debt-entries/${s.loan.id}`)
      .set(auth(s.mei.token))
      .expect(404);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: s.ticket.id } })).ledgerId,
    ).toBe(s.me.ledgerId);
  });

  it('SC-N3：只搬存入與借款，預覽只列信用卡 −$5,000 → $0，執行後餘額一致', async () => {
    const s = await scene();
    const before = await listAccounts(app, s.me.token);
    const input = body([
      { targetLedgerId: s.homeId, itemIds: [s.transfer.id, s.loan.transactionId!] },
    ]);
    const p = (await preview(s, input).expect(200)).body as LedgerLeavePreview;
    expect(p.accounts).toEqual([
      { accountId: s.cardId, name: '信用卡', balance: -500000, balanceAfter: 0 },
    ]);
    expect(p.withdrawals).toEqual([]);
    await execute(s, input).expect(204);
    for (const a of await listAccounts(app, s.me.token))
      expect(a.balance).toBe(
        p.accounts.find((effect) => effect.accountId === a.id)?.balanceAfter ??
          before.find((old) => old.id === a.id)!.balance,
      );
    expect(await prisma.transaction.findUnique({ where: { id: s.ticket.id } })).toBeNull();
    expect(await prisma.ledger.findUnique({ where: { id: s.travelId } })).toBeNull();
  });

  it('SC-N4：moves 空陣列與舊 DELETE 的帳戶、撤銷與對方收到的連動撤銷相同', async () => {
    async function run(legacy: boolean) {
      await resetDb(prisma);
      const s = await scene(true);
      if (legacy)
        await request(server())
          .delete(`/api/ledgers/${s.travelId}`)
          .query({ withdrawDebts: true, confirm: TRAVEL })
          .set(auth(s.me.token))
          .expect(204);
      else await execute(s, body([])).expect(204);
      const entry = await prisma.debtEntry.findUniqueOrThrow({ where: { id: s.loan.id } });
      const incoming = await proposals(app, s.ade!, 'incoming', 'PENDING');
      expect(incoming.map((p) => p.type)).toEqual(['DELETE']);
      return {
        accounts: (await listAccounts(app, s.me.token)).map((a) => ({
          name: a.name,
          balance: a.balance,
        })),
        balance: (await getCounterparty(app, s.me, s.cpId)).balance,
        withdrawn: entry.deletedAt !== null,
        transactionId: entry.transactionId,
        otherAccounts: (await listAccounts(app, s.ade!.token)).map((a) => ({
          name: a.name,
          balance: a.balance,
        })),
        proposals: incoming.map((p) => ({ type: p.type, status: p.status, amount: p.amount })),
        sourceExists: await prisma.ledger.count({ where: { id: s.travelId } }),
      };
    }
    expect(await run(false)).toEqual(await run(true));
  });

  it('SC-N5：同名分類用目標現有的，沒有則同名同圖示新建，不留來源分類 id', async () => {
    const s = await scene();
    const existing = await category(s.me, s.me.ledgerId);
    const custom = await category(s.me, s.travelId, '旅行特別支出');
    const extra = (
      await request(server())
        .post(`/api/ledgers/${s.travelId}/transactions`)
        .set(auth(s.me.token))
        .send({
          type: 'EXPENSE',
          amount: 1000,
          date: DAY,
          title: '特別支出',
          categoryId: custom.id,
          accountId: s.me.cashId,
        })
        .expect(201)
    ).body as Transaction;
    await execute(
      s,
      body([{ targetLedgerId: s.me.ledgerId, itemIds: [...allIds(s), extra.id] }]),
    ).expect(204);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: s.ticket.id } })).categoryId,
    ).toBe(existing.id);
    const moved = await prisma.transaction.findUniqueOrThrow({
      where: { id: extra.id },
      include: { category: true },
    });
    expect(moved.category).toMatchObject({
      ledgerId: s.me.ledgerId,
      name: custom.name,
      icon: custom.icon,
    });
    expect(moved.categoryId).not.toBe(custom.id);
    await expectCategoriesBelong();
  });

  it.each([true, false])(
    'SC-N6：還款及結清分支、個人分帳、3k 合成列整組搬或整組刪（搬=%s）',
    async (selected) => {
      const s = await scene();
      const repayment = (
        await request(server())
          .post('/api/debt-entries')
          .set(auth(s.me.token))
          .send({
            counterparty: { id: s.cpId },
            kind: 'REPAYMENT',
            amount: 98000,
            settle: true,
            date: DAY,
            record: { ledgerId: s.travelId, accountId: s.me.cashId },
          })
          .expect(201)
      ).body as CreateDebtEntryResponse;
      const repaymentId = repayment.entries[0]!.transactionId!;
      const branch = await prisma.transaction.findFirstOrThrow({
        where: { differenceOfId: repaymentId },
      });
      const split = (
        await request(server())
          .post('/api/splits')
          .set(auth(s.me.token))
          .send({
            ledgerId: s.travelId,
            type: 'EXPENSE',
            categoryId: s.ticketCategory.id,
            total: 40000,
            date: DAY,
            title: '個人分帳',
            accountId: s.me.cashId,
            payer: null,
            method: 'EQUAL',
            participants: [{ counterpartyId: null }, { counterpartyId: s.cpId }],
          })
          .expect(201)
      ).body as Split;
      const splitTransactions = await prisma.transaction.findMany({ where: { splitId: split.id } });
      const people = await prisma.ledgerPerson.findMany({ where: { ledgerId: s.homeId } });
      const homeCategory = await category(s.mei, s.homeId, '合併住宿');
      const shared = (
        await request(server())
          .post(`/api/ledgers/${s.homeId}/transactions`)
          .set(auth(s.me.token))
          .send({
            type: 'EXPENSE',
            amount: 30000,
            date: DAY,
            title: '合併住宿',
            accountId: s.me.cashId,
            categoryId: homeCategory.id,
            ledgerSplit: { method: 'EQUAL', shares: people.map((p) => ({ personId: p.id })) },
          })
          .expect(201)
      ).body as Transaction;
      await request(server())
        .post(`/api/ledgers/${s.homeId}/leave`)
        .set(auth(s.me.token))
        .send({ targetLedgerId: s.travelId, excludedItemIds: [] })
        .expect(204);
      const merged = await prisma.transaction.findMany({
        where: { ledgerId: s.travelId, mergedFromId: shared.id },
        orderBy: { id: 'asc' },
      });
      expect(merged).toHaveLength(2);
      const share = merged.find((t) => t.type === 'EXPENSE')!;
      const input = body(
        selected
          ? [{ targetLedgerId: s.me.ledgerId, itemIds: [repaymentId, split.id, share.id] }]
          : [],
      );
      const before = await listAccounts(app, s.me.token);
      const p = (await preview(s, input).expect(200)).body as LedgerLeavePreview;
      expect(p.items).toHaveLength(6);
      expect(p.items.find((i) => i.id === share.id)!.kind).toBe('SHARED');
      expect(
        p.items.some(
          (i) => i.id === branch.id || i.id === merged.find((t) => t.type === 'LEND')!.id,
        ),
      ).toBe(false);
      await execute(s, input).expect(204);
      const internalIds = [
        repaymentId,
        branch.id,
        ...splitTransactions.map((t) => t.id),
        ...merged.map((t) => t.id),
      ];
      const remaining = await prisma.transaction.findMany({ where: { id: { in: internalIds } } });
      expect(remaining).toHaveLength(selected ? internalIds.length : 0);
      for (const t of remaining) expect(t.ledgerId).toBe(s.me.ledgerId);
      if (selected) {
        expect((await prisma.split.findUniqueOrThrow({ where: { id: split.id } })).ledgerId).toBe(
          s.me.ledgerId,
        );
        for (const original of merged)
          expect(remaining.find((t) => t.id === original.id)).toMatchObject({
            mergeId: original.mergeId,
            mergedFromId: original.mergedFromId,
          });
        for (const entry of repayment.entries)
          expect(
            (await prisma.debtEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt,
          ).toBeNull();
      } else {
        expect(await prisma.split.findUnique({ where: { id: split.id } })).toBeNull();
        for (const entry of repayment.entries)
          expect(
            (await prisma.debtEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt,
          ).not.toBeNull();
      }
      expect(await prisma.transaction.count({ where: { ledgerId: s.travelId } })).toBe(0);
      for (const a of await listAccounts(app, s.me.token))
        expect(a.balance).toBe(
          p.accounts.find((effect) => effect.accountId === a.id)?.balanceAfter ??
            before.find((old) => old.id === a.id)!.balance,
        );
      await expectCategoriesBelong();
    },
  );

  it('SC-N14：5 種非法 moves 與種類不符的 request 全部 400，預覽與執行均沒有寫入', async () => {
    const s = await scene();
    const ticket = s.ticket.id;
    const invalid: unknown[] = [
      body([
        { targetLedgerId: s.me.ledgerId, itemIds: [ticket] },
        { targetLedgerId: s.homeId, itemIds: [ticket] },
      ]),
      body([
        { targetLedgerId: s.me.ledgerId, itemIds: [ticket] },
        { targetLedgerId: s.me.ledgerId, itemIds: [s.transfer.id] },
      ]),
      body([{ targetLedgerId: s.me.ledgerId, itemIds: [] }]),
      body([{ targetLedgerId: s.me.ledgerId, itemIds: [s.me.userId] }]),
      body([{ targetLedgerId: s.travelId, itemIds: [ticket] }]),
      { deleteLedger: true },
      { ...body([]), targetLedgerId: null },
      { ...body([]), excludedItemIds: null },
      { ...body([]), deleteLedger: false },
      { ...body([]), deleteLedger: undefined },
      { ...body([]), moves: null },
    ];
    const before = await snapshot();
    for (const input of invalid) {
      await preview(s, input as LeaveRequest).expect(400);
      await execute(s, input as LeaveRequest).expect(400);
      expect(await snapshot()).toEqual(before);
    }
    for (const input of [
      { targetLedgerId: null, excludedItemIds: [], moves: [] },
      { excludedItemIds: [] },
      { targetLedgerId: null },
    ]) {
      for (const suffix of ['leave-preview', 'leave'])
        await request(server())
          .post(`/api/ledgers/${s.homeId}/${suffix}`)
          .set(auth(s.me.token))
          .send(input)
          .expect(400);
      expect(await snapshot()).toEqual(before);
    }
  });

  it('封存預覽回 blocker，仍驗 moves 形狀與目標；執行拒絕且沒有寫入', async () => {
    const s = await scene();
    await request(server())
      .post(`/api/ledgers/${s.travelId}/archive`)
      .set(auth(s.me.token))
      .expect(201);
    expect(((await preview(s, body([])).expect(200)).body as LedgerLeavePreview).leave).toEqual({
      allowed: false,
      blockedBy: 'LEDGER_ARCHIVED',
    });
    const before = await snapshot();
    await preview(s, body([{ targetLedgerId: s.me.ledgerId, itemIds: [] }])).expect(400);
    await preview(s, body([{ targetLedgerId: s.mei.ledgerId, itemIds: [s.ticket.id] }])).expect(
      404,
    );
    await execute(s, body([])).expect(409);
    expect(await snapshot()).toEqual(before);
  });

  it('中途 deleteLedgerRows 失敗：帳本、交易歸屬、分類與撤銷全部回滾', async () => {
    const s = await scene();
    const before = await snapshot();
    const spy = jest
      .spyOn(app.get(LedgersService), 'deleteLedgerRows')
      .mockRejectedValueOnce(new Error('Injected deletion failure'));
    try {
      await execute(s, body([{ targetLedgerId: s.me.ledgerId, itemIds: [s.ticket.id] }])).expect(
        500,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: s.ticket.id } })).ledgerId,
    ).toBe(s.travelId);
    expect(await prisma.ledger.findUnique({ where: { id: s.travelId } })).not.toBeNull();
  });
});
