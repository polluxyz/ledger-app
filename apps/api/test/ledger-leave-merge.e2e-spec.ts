import { INestApplication } from '@nestjs/common';
import type {
  Category,
  CreateDebtEntryResponse,
  LedgerGroup,
  LedgerLeavePreview,
  LeaveRequest,
  Split,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { DebtEntriesService } from '../src/debts/debt-entries.service';
import { LedgersService } from '../src/ledgers/ledgers.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import {
  auth,
  createCounterparty,
  linkPair,
  person,
  proposals,
  type Person,
} from './linking-utils';

/**
 * 3k SC-K1、K2、K3、K6、K7、K8、K11：以「我、小明、小華；住宿、晚餐、結清」
 * 驗證合併後帳戶不變、只記本人份額、帳本轉入沿用借還頁、分類重建與個人借還搬家／撤銷。
 * 策略：真實 HTTP 與專屬 PostgreSQL；比對 GET /accounts 與預覽，直接讀資料庫檢查外鍵、
 * 連動配對及無殘留寫入；僅失敗注入的測試 mock 一個內部步驟，讓真實資料庫證明整筆回滾。
 */
describe('Ledger leave and merge (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const DAY = '2026-10-18T12:00:00.000Z';
  const server = () => httpServer(app);
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function category(who: Person, ledgerId: string, name = '住宿') {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(who.token))
      .send({ name, type: 'EXPENSE', icon: 'travel' })
      .expect(201);
    return res.body as Category;
  }
  async function scene(seed = true) {
    const me = await person(app, 'me@example.com', '我');
    const ming = await person(app, 'ming@example.com', '小明');
    const hua = await person(app, 'hua@example.com', '小華');
    const ledgerId = await createSharedLedger(app, ming.token, '花蓮三日');
    for (const p of [me, hua])
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(ming.token))
        .send({ email: p.email, role: 'EDITOR' })
        .expect(201);
    const people = await prisma.ledgerPerson.findMany({ where: { ledgerId } });
    const meId = people.find((p) => p.userId === me.userId)!.id;
    const mingId = people.find((p) => p.userId === ming.userId)!.id;
    const huaId = people.find((p) => p.userId === hua.userId)!.id;
    const card = await request(server())
      .post('/api/accounts')
      .set(auth(me.token))
      .send({ name: '信用卡', initialBalance: -940000 })
      .expect(201);
    const cardId = (card.body as { id: string }).id;
    const hostel = await category(ming, ledgerId);
    const dinner = await category(ming, ledgerId, '晚餐');
    const ids = { hostel: '', dinner: '', settlement: '' };
    if (seed) {
      const split = {
        method: 'EQUAL',
        shares: [meId, mingId, huaId].map((personId) => ({ personId })),
      };
      for (const [who, title, amount, accountId, categoryId, key] of [
        [me, '住宿', 300000, cardId, hostel.id, 'hostel'],
        [ming, '晚餐', 150000, ming.cashId, dinner.id, 'dinner'],
      ] as const) {
        const res = await request(server())
          .post(`/api/ledgers/${ledgerId}/transactions`)
          .set(auth(who.token))
          .send({
            type: 'EXPENSE',
            amount,
            date: DAY,
            title,
            accountId,
            categoryId,
            ledgerSplit: split,
          })
          .expect(201);
        ids[key] = (res.body as Transaction).id;
      }
      const res = await request(server())
        .post(`/api/ledgers/${ledgerId}/settlements`)
        .set(auth(me.token))
        .send({
          fromPersonId: huaId,
          toPersonId: meId,
          amount: 100000,
          date: DAY,
          toAccountId: me.cashId,
        })
        .expect(201);
      ids.settlement = (res.body as Transaction).id;
    }
    return { me, ming, hua, ledgerId, meId, mingId, huaId, cardId, hostel, dinner, ids };
  }
  type Scene = Awaited<ReturnType<typeof scene>>;
  const body = (who: Person, overrides: Partial<LeaveRequest> = {}): LeaveRequest => ({
    targetLedgerId: who.ledgerId,
    excludedItemIds: [],
    ...overrides,
  });
  const preview = (who: Person, ledgerId: string, input = body(who)) =>
    request(server())
      .post(`/api/ledgers/${ledgerId}/leave-preview`)
      .set(auth(who.token))
      .send(input);
  const leave = (who: Person, ledgerId: string, input = body(who)) =>
    request(server()).post(`/api/ledgers/${ledgerId}/leave`).set(auth(who.token)).send(input);
  async function groups(who: Person) {
    return (await request(server()).get('/api/ledger-groups').set(auth(who.token)).expect(200))
      .body as LedgerGroup[];
  }
  async function snapshot(s: Scene) {
    return {
      transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      merges: await prisma.ledgerMerge.findMany(),
      entries: await prisma.debtEntry.findMany({ orderBy: { id: 'asc' } }),
      categories: await prisma.category.findMany({ orderBy: { id: 'asc' } }),
      pointers: await prisma.ledgerPersonPointer.findMany(),
      counterparties: await prisma.counterparty.findMany({ orderBy: { id: 'asc' } }),
      member: await prisma.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: s.me.userId } },
      }),
      accounts: await listAccounts(app, s.me.token),
    };
  }
  async function debt(s: Scene, counterpartyId: string, kind = 'LEND', amount = 50000) {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(s.me.token))
      .send({
        counterparty: { id: counterpartyId },
        kind,
        amount,
        date: DAY,
        title: '借明哥',
        record: { ledgerId: s.ledgerId, accountId: s.me.cashId },
        categoryId: s.hostel.id,
      })
      .expect(201);
    return (res.body as CreateDebtEntryResponse).entries[0]!;
  }
  async function split(s: Scene, cp: string) {
    return (
      await request(server())
        .post('/api/splits')
        .set(auth(s.me.token))
        .send({
          ledgerId: s.ledgerId,
          type: 'EXPENSE',
          categoryId: s.dinner.id,
          total: 40000,
          date: DAY,
          title: '個人分帳',
          accountId: s.me.cashId,
          payer: null,
          method: 'EQUAL',
          participants: [{ counterpartyId: null }, { counterpartyId: cp }],
        })
        .expect(201)
    ).body as Split;
  }

  it('SC-K1/K3/K7：全部合併，各帳戶 GET /accounts 完全不變、統計只加 $1500，往來金額沿用借還頁', async () => {
    const s = await scene();
    const targetCategory = await category(s.me, s.me.ledgerId);
    const before = await listAccounts(app, s.me.token);
    const amountBefore = (await groups(s.me))
      .find((g) => g.ledger.id === s.ledgerId)!
      .people.filter((p) => p.amount !== 0);
    expect(amountBefore.map((p) => [p.person.name, p.amount])).toEqual([['小華', 50000]]);
    const p = (await preview(s.me, s.ledgerId).expect(200)).body as LedgerLeavePreview;
    expect(p.accounts).toEqual([]);
    expect(p.items).toHaveLength(3);
    expect(p.carryOvers.map((c) => [c.displayName, c.amount])).toEqual([['小華', 50000]]);
    await leave(s.me, s.ledgerId).expect(204);
    expect(await listAccounts(app, s.me.token)).toEqual(before);
    const rows = await prisma.transaction.findMany({
      where: { ledgerId: s.me.ledgerId },
      include: { category: true },
    });
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.type === 'EXPENSE').reduce((n, r) => n + r.amount, 0)).toBe(150000);
    expect(
      rows
        .filter((r) => r.mergedFromId === s.ids.hostel)
        .map((r) => r.amount)
        .sort((a, b) => a - b),
    ).toEqual([100000, 200000]);
    expect(rows.find((r) => r.type === 'LEND')!.categoryId).toBeNull();
    expect(rows.find((r) => r.type === 'COLLECT')!.title).toBe('結清 · 小華');
    expect(rows.find((r) => r.mergedFromId === s.ids.dinner)!.accountId).toBeNull();
    expect(rows.find((r) => r.category?.name === '住宿')!.categoryId).toBe(targetCategory.id);
    const copiedDinner = rows.find((r) => r.category?.name === '晚餐')!.category!;
    expect(copiedDinner.ledgerId).toBe(s.me.ledgerId);
    expect(copiedDinner.icon).toBe(s.dinner.icon);
    expect(rows.every((r) => r.categoryId !== s.hostel.id && r.categoryId !== s.dinner.id)).toBe(
      true,
    );
    const carry = await prisma.debtEntry.findFirstOrThrow({
      where: { kind: 'LEDGER_CARRY_OVER', counterparty: { ownerId: s.me.userId } },
      include: { merge: true, counterparty: true },
    });
    expect(carry.delta).toBe(50000);
    expect(carry.transactionId).toBeNull();
    expect(carry.counterparty.name).toBe('小華');
    expect(carry.merge!.sourceLedgerName).toBe('花蓮三日');
    expect(carry.merge!.targetLedgerId).toBe(s.me.ledgerId);
    expect(
      await prisma.ledgerPersonPointer.count({
        where: { userId: s.me.userId, ledgerPerson: { ledgerId: s.ledgerId } },
      }),
    ).toBe(0);
    await request(server()).get(`/api/ledgers/${s.ledgerId}`).set(auth(s.me.token)).expect(404);
  });

  it('SC-K2/K11：取消住宿，預覽信用卡少扣 $3000，執行餘額逐一符合預覽，帳本轉入仍有', async () => {
    const s = await scene();
    const input = body(s.me, { excludedItemIds: [s.ids.hostel] });
    const p = (await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview;
    expect(p.accounts).toHaveLength(1);
    expect(p.accounts[0]!.accountId).toBe(s.cardId);
    expect(p.accounts[0]!.balanceAfter - p.accounts[0]!.balance).toBe(300000);
    const before = await listAccounts(app, s.me.token);
    await leave(s.me, s.ledgerId, input).expect(204);
    const after = await listAccounts(app, s.me.token);
    for (const account of after)
      expect(account.balance).toBe(
        p.accounts.find((a) => a.accountId === account.id)?.balanceAfter ??
          before.find((a) => a.id === account.id)!.balance,
      );
    expect(await prisma.transaction.count({ where: { mergedFromId: s.ids.hostel } })).toBe(0);
    expect(
      (await prisma.debtEntry.findFirstOrThrow({ where: { kind: 'LEDGER_CARRY_OVER' } })).delta,
    ).toBe(50000);
  });

  it('全部不勾不需目標，LedgerMerge 的 targetLedgerId 是 null', async () => {
    const s = await scene();
    const input = body(s.me, { targetLedgerId: null, excludedItemIds: Object.values(s.ids) });
    const p = (await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview;
    expect(p.accounts).toHaveLength(2);
    await leave(s.me, s.ledgerId, input).expect(204);
    expect((await prisma.ledgerMerge.findFirstOrThrow()).targetLedgerId).toBeNull();
    expect(await prisma.transaction.count({ where: { ledgerId: s.me.ledgerId } })).toBe(0);
    expect(await prisma.debtEntry.count({ where: { kind: 'LEDGER_CARRY_OVER' } })).toBe(1);
  });

  it('SC-K6：勾選連動個人借還直接搬家，配對與往來不變、不發提議，含分類與分帳也搬到目標', async () => {
    const s = await scene();
    const linked = await linkPair(app, s.me, s.ming);
    const entry = await debt(s, linked.aCounterpartyId);
    const incoming = (await proposals(app, s.ming, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${incoming.id}/accept`)
      .set(auth(s.ming.token))
      .send({ record: { ledgerId: s.ming.ledgerId, accountId: s.ming.cashId } })
      .expect(200);
    const paid = await debt(s, linked.aCounterpartyId, 'LEND', 3000);
    const personalSplit = await split(s, linked.aCounterpartyId);
    const beforeEntries = await prisma.debtEntry.findMany({
      where: { counterpartyId: linked.aCounterpartyId },
      orderBy: { id: 'asc' },
    });
    const proposalsBefore = await prisma.debtProposal.count();
    const accountsBefore = await listAccounts(app, s.me.token);
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/members/${s.me.userId}`)
      .set(auth(s.ming.token))
      .send({ role: 'VIEWER' })
      .expect(200);
    await leave(s.me, s.ledgerId).expect(204);
    expect(
      await prisma.debtEntry.findMany({
        where: { counterpartyId: linked.aCounterpartyId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(beforeEntries);
    expect(await prisma.debtProposal.count()).toBe(proposalsBefore);
    expect(await listAccounts(app, s.me.token)).toEqual(accountsBefore);
    for (const id of [entry.transactionId!, paid.transactionId!])
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).ledgerId).toBe(
        s.me.ledgerId,
      );
    const movedPaid = await prisma.transaction.findUniqueOrThrow({
      where: { id: paid.transactionId! },
      include: { category: true },
    });
    expect(movedPaid.category!.ledgerId).toBe(s.me.ledgerId);
    const movedSplit = await prisma.split.findUniqueOrThrow({
      where: { id: personalSplit.id },
      include: { category: true, transactions: { include: { category: true } } },
    });
    expect(movedSplit.ledgerId).toBe(s.me.ledgerId);
    expect(movedSplit.category.ledgerId).toBe(s.me.ledgerId);
    expect(
      movedSplit.transactions.every(
        (t) =>
          t.ledgerId === s.me.ledgerId && (!t.category || t.category.ledgerId === s.me.ledgerId),
      ),
    ).toBe(true);
    expect(beforeEntries.find((e) => e.id === entry.id)!.pairedEntryId).not.toBeNull();
  });

  it('SC-K6：未勾的已配對借還照 3j 撤銷，檢視者也能退出並送撤銷提議', async () => {
    const s = await scene();
    const linked = await linkPair(app, s.me, s.ming);
    const entry = await debt(s, linked.aCounterpartyId);
    const incoming = (await proposals(app, s.ming, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${incoming.id}/accept`)
      .set(auth(s.ming.token))
      .send({ record: { ledgerId: s.ming.ledgerId, accountId: s.ming.cashId } })
      .expect(200);
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/members/${s.me.userId}`)
      .set(auth(s.ming.token))
      .send({ role: 'VIEWER' })
      .expect(200);
    const input = body(s.me, { excludedItemIds: [entry.transactionId!] });
    const p = (await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview;
    expect(p.withdrawals).toEqual([
      expect.objectContaining({
        counterpartyId: linked.aCounterpartyId,
        linked: true,
        balance: 50000,
        balanceAfter: 0,
      }),
    ]);
    await leave(s.me, s.ledgerId, input).expect(204);
    expect(
      (await prisma.debtEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt,
    ).not.toBeNull();
    expect((await proposals(app, s.ming, 'incoming', 'PENDING')).map((p) => p.type)).toEqual([
      'DELETE',
    ]);
  });

  it('檢視者未勾的個人分帳同樣撤銷；預覽按同一對象彙總，沒有重複列共享交易', async () => {
    const s = await scene(false);
    const cp = await createCounterparty(app, s.me, '朋友');
    const personalSplit = await split(s, cp.id);
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/members/${s.me.userId}`)
      .set(auth(s.ming.token))
      .send({ role: 'VIEWER' })
      .expect(200);
    const input = body(s.me, { targetLedgerId: null, excludedItemIds: [personalSplit.id] });
    const p = (await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview;
    expect(p.items.map((i) => [i.id, i.kind])).toEqual([[personalSplit.id, 'PERSONAL_SPLIT']]);
    expect(p.withdrawals[0]!.balanceAfter).toBe(0);
    await leave(s.me, s.ledgerId, input).expect(204);
    expect(
      (await prisma.split.findUniqueOrThrow({ where: { id: personalSplit.id } })).deletedAt,
    ).not.toBeNull();
  });

  it.each([true, false])(
    '還款的結清分支跟同一勾選項目一起搬家或撤銷（合併=%s）',
    async (selected) => {
      const s = await scene(false);
      const cp = await createCounterparty(app, s.me, '明哥');
      await debt(s, cp.id);
      const repayment = (
        await request(server())
          .post('/api/debt-entries')
          .set(auth(s.me.token))
          .send({
            counterparty: { id: cp.id },
            kind: 'REPAYMENT',
            amount: 48000,
            settle: true,
            date: DAY,
            record: { ledgerId: s.ledgerId, accountId: s.me.cashId },
          })
          .expect(201)
      ).body as CreateDebtEntryResponse;
      const entry = repayment.entries[0]!;
      const branch = await prisma.transaction.findFirstOrThrow({
        where: { differenceOfId: entry.transactionId! },
      });
      const input = body(s.me, { excludedItemIds: selected ? [] : [entry.transactionId!] });
      const before = await listAccounts(app, s.me.token);
      const p = (await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview;
      expect(p.items).toHaveLength(2);
      expect(p.items.every((i) => i.kind === 'PERSONAL_DEBT')).toBe(true);
      await leave(s.me, s.ledgerId, input).expect(204);
      const after = await listAccounts(app, s.me.token);
      for (const a of after)
        expect(a.balance).toBe(
          p.accounts.find((impact) => impact.accountId === a.id)?.balanceAfter ??
            before.find((b) => b.id === a.id)!.balance,
        );
      const branchAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: branch.id } });
      expect(branchAfter.differenceOfId).toBe(entry.transactionId);
      if (selected) {
        expect(branchAfter.ledgerId).toBe(s.me.ledgerId);
        expect(branchAfter.deletedAt).toBeNull();
      } else {
        expect(branchAfter.deletedAt).not.toBeNull();
        expect(
          (await prisma.debtEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt,
        ).not.toBeNull();
      }
    },
  );

  it.each([true, false])(
    '帳本轉入沿用自己的指向，沒有指向時同名對象加帳本名稱（指向=%s）',
    async (pointed) => {
      const s = await scene();
      const cp = await createCounterparty(app, s.me, '小華');
      if (pointed)
        await prisma.ledgerPersonPointer.create({
          data: { userId: s.me.userId, ledgerPersonId: s.huaId, counterpartyId: cp.id },
        });
      const p = (await preview(s.me, s.ledgerId).expect(200)).body as LedgerLeavePreview;
      expect(p.carryOvers[0]!.counterpartyId).toBe(pointed ? cp.id : null);
      await leave(s.me, s.ledgerId).expect(204);
      const carry = await prisma.debtEntry.findFirstOrThrow({
        where: { kind: 'LEDGER_CARRY_OVER' },
        include: { counterparty: true },
      });
      expect(carry.delta).toBe(50000);
      if (pointed) expect(carry.counterpartyId).toBe(cp.id);
      else {
        expect(carry.counterpartyId).not.toBe(cp.id);
        expect(carry.counterparty.name).toBe('小華（花蓮三日）');
      }
      expect(await prisma.ledgerPersonPointer.count({ where: { userId: s.me.userId } })).toBe(0);
    },
  );

  it('SC-K11：預覽後封存目標，執行 409 且來源成員、帳戶、交易、LedgerMerge 全部無寫入', async () => {
    const s = await scene();
    await preview(s.me, s.ledgerId).expect(200);
    await request(server())
      .post(`/api/ledgers/${s.me.ledgerId}/archive`)
      .set(auth(s.me.token))
      .expect(201);
    const before = await snapshot(s);
    const res = await leave(s.me, s.ledgerId).expect(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');
    expect(await snapshot(s)).toEqual(before);
  });

  it('SC-K11：合併交易已寫入後撤銷步驟失敗，真實 DB 整筆回滾', async () => {
    const s = await scene();
    const cp = await createCounterparty(app, s.me, '明哥');
    const entry = await debt(s, cp.id);
    const before = await snapshot(s);
    const fault = jest
      .spyOn(app.get(DebtEntriesService), 'removeInTransaction')
      .mockRejectedValueOnce(new Error('injected withdrawal failure'));
    try {
      await leave(s.me, s.ledgerId, body(s.me, { excludedItemIds: [entry.transactionId!] })).expect(
        500,
      );
    } finally {
      fault.mockRestore();
    }
    expect(await snapshot(s)).toEqual(before);
  });

  it('SC-K8：其他人先退出，最後一位擁有者可以合併後刪除帳本，保留合併紀錄與分類', async () => {
    const s = await scene();
    const blocked = await leave(
      s.ming,
      s.ledgerId,
      body(s.ming, { deleteLedger: true, confirm: '花蓮三日' }),
    ).expect(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe('LEDGER_HAS_OTHER_MEMBERS');
    await leave(s.me, s.ledgerId).expect(204);
    await leave(s.hua, s.ledgerId).expect(204);
    const before = await listAccounts(app, s.ming.token);
    const input = body(s.ming, { deleteLedger: true, confirm: '花蓮三日' });
    expect(
      ((await preview(s.ming, s.ledgerId, input).expect(200)).body as LedgerLeavePreview).leave,
    ).toEqual({ allowed: true, blockedBy: null });
    await leave(s.ming, s.ledgerId, input).expect(204);
    expect(await prisma.ledger.findUnique({ where: { id: s.ledgerId } })).toBeNull();
    expect(await listAccounts(app, s.ming.token)).toEqual(before);
    expect(
      await prisma.transaction.count({
        where: { ledgerId: s.ming.ledgerId, mergedFromId: { not: null } },
      }),
    ).toBeGreaterThan(0);
    expect(await prisma.ledgerMerge.count({ where: { sourceLedgerId: s.ledgerId } })).toBe(3);
  });

  it('SC-K11：清帳戶與刪指向後刪帳本失敗，也會還原完整來源與合併寫入', async () => {
    const s = await scene();
    await leave(s.hua, s.ledgerId).expect(204);
    await leave(s.ming, s.ledgerId, body(s.ming)).expect(409); // 最後一位擁有者不可直接退出
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}/members/${s.me.userId}`)
      .set(auth(s.ming.token))
      .send({ role: 'OWNER' })
      .expect(200);
    await leave(s.ming, s.ledgerId).expect(204);
    const cp = await createCounterparty(app, s.me, '小華');
    await prisma.ledgerPersonPointer.create({
      data: { userId: s.me.userId, ledgerPersonId: s.huaId, counterpartyId: cp.id },
    });
    const before = await snapshot(s);
    const fault = jest
      .spyOn(app.get(LedgersService), 'deleteLedgerRows')
      .mockRejectedValueOnce(new Error('injected deletion failure'));
    try {
      await leave(s.me, s.ledgerId, body(s.me, { deleteLedger: true, confirm: '花蓮三日' })).expect(
        500,
      );
    } finally {
      fault.mockRestore();
    }
    expect(await snapshot(s)).toEqual(before);
  });

  it('舊 DELETE 回歸：只剩擁有者且有共享分帳、結清，先刪交易才能安全刪帳本', async () => {
    const owner = await person(app, 'owner@example.com', '擁有者');
    const ledgerId = await createSharedLedger(app, owner.token, '刪除回歸');
    const meId = (
      await prisma.ledgerPerson.findUniqueOrThrow({
        where: { ledgerId_userId: { ledgerId, userId: owner.userId } },
      })
    ).id;
    const guest = await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(owner.token))
      .send({ name: '旅伴' })
      .expect(201);
    const guestId = (guest.body as { id: string }).id;
    const c = await category(owner, ledgerId);
    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(owner.token))
      .send({
        type: 'EXPENSE',
        amount: 10000,
        date: DAY,
        categoryId: c.id,
        accountId: owner.cashId,
        ledgerSplit: { method: 'EQUAL', shares: [{ personId: meId }, { personId: guestId }] },
      })
      .expect(201);
    await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(owner.token))
      .send({
        fromPersonId: guestId,
        toPersonId: meId,
        amount: 1000,
        date: DAY,
        toAccountId: owner.cashId,
      })
      .expect(201);
    await request(server())
      .delete(`/api/ledgers/${ledgerId}`)
      .set(auth(owner.token))
      .query({ confirm: '刪除回歸' })
      .expect(204);
    expect(await prisma.ledger.count({ where: { id: ledgerId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { ledgerId } })).toBe(0);
  });

  it('清帳戶含軟刪除交易、臨時帳戶與轉帳兩端；別人的另一端不變', async () => {
    const s = await scene(false);
    const res = await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.ming.token))
      .send({
        type: 'EXPENSE',
        amount: 5000,
        date: DAY,
        title: '代記',
        categoryId: s.hostel.id,
        payerPersonId: s.meId,
      })
      .expect(201);
    const id = (res.body as Transaction).id;
    const original = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: { account: true },
    });
    expect(original.account!.isTemporary).toBe(true);
    await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/transactions/${id}`)
      .set(auth(s.ming.token))
      .expect(204);
    const input = body(s.me, { targetLedgerId: null });
    expect(
      ((await preview(s.me, s.ledgerId, input).expect(200)).body as LedgerLeavePreview).items,
    ).toEqual([]);
    await leave(s.me, s.ledgerId, input).expect(204);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).accountId).toBeNull();
  });

  it('封存來源仍可 200 預覽 blocked，執行 409；來源無寫入', async () => {
    const s = await scene();
    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/archive`)
      .set(auth(s.ming.token))
      .expect(201);
    const before = await snapshot(s);
    const p = (await preview(s.me, s.ledgerId).expect(200)).body as LedgerLeavePreview;
    expect(p.leave).toEqual({ allowed: false, blockedBy: 'LEDGER_ARCHIVED' });
    await leave(s.me, s.ledgerId).expect(409);
    expect(await snapshot(s)).toEqual(before);
  });

  it.each([
    { targetLedgerId: null, excludedItemIds: 'wrong' },
    { targetLedgerId: 'not-uuid', excludedItemIds: [] },
    { targetLedgerId: null, excludedItemIds: ['not-uuid'] },
    { targetLedgerId: null, excludedItemIds: [], deleteLedger: 'true' },
    { excludedItemIds: [] },
  ])('DTO 拒絕錯誤輸入：%j', async (input) => {
    const s = await scene(false);
    await preview(s.me, s.ledgerId, input as LeaveRequest).expect(400);
    await leave(s.me, s.ledgerId, input as LeaveRequest).expect(400);
    expect(await prisma.ledgerMerge.count()).toBe(0);
  });

  // W192：帳本轉入的往來紀錄帶出來源帳本名稱（退出當下的快照，之後改名也不變）；
  // 同一個對象的一般往來紀錄沒有合併紀錄，merge 為 null。
  it('W192：往來紀錄的帳本轉入帶來源帳本名稱，其他紀錄 merge 為 null', async () => {
    const s = await scene();
    const cp = await createCounterparty(app, s.me, '小華');
    await prisma.ledgerPersonPointer.create({
      data: { userId: s.me.userId, ledgerPersonId: s.huaId, counterpartyId: cp.id },
    });
    await request(server())
      .post('/api/debt-entries')
      .set(auth(s.me.token))
      .send({
        counterparty: { id: cp.id },
        kind: 'LEND',
        amount: 20000,
        date: DAY,
        record: { ledgerId: s.me.ledgerId, accountId: s.me.cashId },
      })
      .expect(201);
    await leave(s.me, s.ledgerId).expect(204);
    await request(server())
      .patch(`/api/ledgers/${s.ledgerId}`)
      .set(auth(s.ming.token))
      .send({ name: '花蓮四日' })
      .expect(200);

    const res = await request(server())
      .get(`/api/counterparties/${cp.id}/entries`)
      .set(auth(s.me.token))
      .expect(200);
    const entries = (res.body as { items: Array<{ kind: string; merge: unknown }> }).items;
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.kind === 'LEDGER_CARRY_OVER')!.merge).toEqual({
      sourceLedgerName: '花蓮三日',
    });
    expect(entries.find((entry) => entry.kind === 'LEND')!.merge).toBeNull();
  });

  // 決策 199「不會重複計算」：被加回後再退出，第一次已合併過的原交易不再列為項目、不再合併，
  // 目標帳本不會多出第二份份額（統計重複）；帳戶也照樣不變。
  it('被加回後再退出：已合併過的交易不再合併第二次', async () => {
    const s = await scene();
    await leave(s.me, s.ledgerId).expect(204);
    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/members`)
      .set(auth(s.ming.token))
      .send({ email: s.me.email, role: 'EDITOR' })
      .expect(201);
    const before = await listAccounts(app, s.me.token);
    const mergedIds = [s.ids.hostel, s.ids.dinner, s.ids.settlement];
    const copies = () => prisma.transaction.count({ where: { mergedFromId: { in: mergedIds } } });
    const copiesBefore = await copies();

    const p = (await preview(s.me, s.ledgerId).expect(200)).body as LedgerLeavePreview;
    for (const id of mergedIds) expect(p.items.some((item) => item.id === id)).toBe(false);

    await leave(s.me, s.ledgerId).expect(204);
    expect(await copies()).toBe(copiesBefore);
    expect(await listAccounts(app, s.me.token)).toEqual(before);
  });

  // 決策 208：被加回時撤銷我上次的帳本轉入，這筆錢回到帳本裡算，小華欠我的總額不會變成兩倍；
  // 再退出只留一筆帳本轉入。小華自己先退出留下的帳本轉入是他的，不能被動到。
  // 「總額」＝我未撤銷的帳本轉入 ＋ 借還頁這本帳本裡小華的金額（退出時指向已照決策 190 刪掉，
  // 被加回後那 $500 列在帳本區，不掛在對象底下）。
  it('被加回時撤銷上次的帳本轉入：總額不重複，再退出只有一筆，別人的帳本轉入不動', async () => {
    const s = await scene();
    const carryOvers = (userId: string) =>
      prisma.debtEntry.findMany({
        where: { kind: 'LEDGER_CARRY_OVER', deletedAt: null, counterparty: { ownerId: userId } },
      });
    const owedByHua = async () => {
      const personal = (await carryOvers(s.me.userId)).reduce((sum, e) => sum + e.delta, 0);
      const group = (await groups(s.me)).find((g) => g.ledger.id === s.ledgerId);
      const inLedger = group?.people.find((p) => p.person.id === s.huaId)?.amount ?? 0;
      return personal + inLedger;
    };
    expect(await owedByHua()).toBe(50000);

    await leave(s.hua, s.ledgerId, body(s.hua)).expect(204);
    const huaCarryOvers = await carryOvers(s.hua.userId);
    expect(huaCarryOvers.length).toBeGreaterThan(0);
    await leave(s.me, s.ledgerId).expect(204);
    expect((await carryOvers(s.me.userId)).map((e) => e.delta)).toEqual([50000]);
    expect(await owedByHua()).toBe(50000);

    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/members`)
      .set(auth(s.ming.token))
      .send({ email: s.me.email, role: 'EDITOR' })
      .expect(201);
    expect(await carryOvers(s.me.userId)).toHaveLength(0);
    expect(await owedByHua()).toBe(50000);
    expect(await carryOvers(s.hua.userId)).toEqual(huaCarryOvers);

    await leave(s.me, s.ledgerId).expect(204);
    expect((await carryOvers(s.me.userId)).map((e) => e.delta)).toEqual([50000]);
    expect(await owedByHua()).toBe(50000);
  });
});
