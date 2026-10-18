import { INestApplication } from '@nestjs/common';
import type {
  Category,
  Counterparty,
  LeaveRequest,
  LedgerLeavePreview,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, createCounterparty, person, type Person } from './linking-utils';

/**
 * 3k 的授權與資料隔離（spec `phase-3k-leave-and-merge.md` SC-K10、SC-K4、SC-K9 的權限）。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - 退出預覽與退出只有成員能用；不是成員 404，不透露帳本存在。目標帳本不是我的 404、
 *   我是檢視者 403、等於來源帳本 400，而且都沒有寫入。
 * - 預覽只含呼叫者自己的帳戶與對象；別人付的交易沒有帳戶影響。
 * - 退出只動自己的帳：其他成員的帳戶、借還、看到的交易都不變；合併寫入的交易只用自己的帳戶；
 *   來源帳本不再引用退出者的帳戶（決策 190）。
 * - 已退出的人當付款人或結清方，不記到任何帳戶，他的帳戶不變（決策 191）。
 * - 擁有者不能移除還有帳的成員；舊的自己退出端點一律 409，不能繞過合併（決策 206、207）。
 *
 * 場景：Carol 擁有共享帳本「花蓮三日」，Bob 是 EDITOR。Carol 另有一本共享帳本「公司聚餐」，
 * Bob 在那裡是 VIEWER。Eve 不在任何一本裡。全部走 HTTP，只在斷言「沒有寫入」與「用了誰的帳戶」
 * 時直接讀資料庫。SC-K4 用資料庫刪成員模擬「已退出」，讓 K2 不必等退出端點就能驗。
 */
describe('Ledger leave and merge — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-18T12:00:00.000Z';
  const HUALIEN = '花蓮三日';

  interface Scene {
    bob: Person;
    carol: Person;
    eve: Person;
    ledgerId: string;
    viewerLedgerId: string;
    bobPersonId: string;
    carolPersonId: string;
  }

  async function scene(): Promise<Scene> {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const ledgerId = await createSharedLedger(app, carol.token, HUALIEN);
    const viewerLedgerId = await createSharedLedger(app, carol.token, '公司聚餐');
    for (const [id, role] of [
      [ledgerId, 'EDITOR'],
      [viewerLedgerId, 'VIEWER'],
    ] as const) {
      await request(server())
        .post(`/api/ledgers/${id}/members`)
        .set(auth(carol.token))
        .send({ email: bob.email, role })
        .expect(201);
    }
    const personOf = async (userId: string) =>
      (
        await prisma.ledgerPerson.findUniqueOrThrow({
          where: { ledgerId_userId: { ledgerId, userId } },
        })
      ).id;
    return {
      bob,
      carol,
      eve,
      ledgerId,
      viewerLedgerId,
      bobPersonId: await personOf(bob.userId),
      carolPersonId: await personOf(carol.userId),
    };
  }

  async function expenseCategory(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  /** 住宿：Bob 用現金付 $3,000，兩人平分；晚餐：Carol 用現金付 $1,500，兩人平分。 */
  async function seed(s: Scene): Promise<void> {
    const shares = {
      method: 'EQUAL',
      shares: [{ personId: s.carolPersonId }, { personId: s.bobPersonId }],
    };
    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.bob.token))
      .send({
        type: 'EXPENSE',
        amount: 300000,
        date: DAY,
        title: '住宿',
        categoryId: await expenseCategory(s.bob, s.ledgerId),
        accountId: s.bob.cashId,
        ledgerSplit: shares,
      })
      .expect(201);
    await request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.carol.token))
      .send({
        type: 'EXPENSE',
        amount: 150000,
        date: DAY,
        title: '晚餐',
        categoryId: await expenseCategory(s.carol, s.ledgerId),
        accountId: s.carol.cashId,
        ledgerSplit: shares,
      })
      .expect(201);
  }

  const all = (overrides: Partial<LeaveRequest> = {}): LeaveRequest => ({
    targetLedgerId: null,
    excludedItemIds: [],
    ...overrides,
  });

  function preview(who: Person, ledgerId: string, body: LeaveRequest) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/leave-preview`)
      .set(auth(who.token))
      .send(body);
  }

  function leave(who: Person, ledgerId: string, body: LeaveRequest) {
    return request(server()).post(`/api/ledgers/${ledgerId}/leave`).set(auth(who.token)).send(body);
  }

  async function isMember(ledgerId: string, userId: string): Promise<boolean> {
    return (await prisma.ledgerMember.count({ where: { ledgerId, userId } })) === 1;
  }

  /** 「沒有寫入」的比對基準：交易、帳戶、往來紀錄、合併前後的總數。 */
  async function counts() {
    return {
      transactions: await prisma.transaction.count(),
      accounts: await prisma.account.count(),
      debtEntries: await prisma.debtEntry.count(),
      counterparties: await prisma.counterparty.count(),
      categories: await prisma.category.count(),
    };
  }

  /** Carol 看到的交易；付款人的「已退出」狀態本來就會變，只比對內容。 */
  async function carolView(s: Scene) {
    const res = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.carol.token))
      .expect(200);
    return (res.body as Paginated<Transaction>).items.map((item) => ({
      id: item.id,
      type: item.type,
      amount: item.amount,
      date: item.date,
      title: item.title,
      category: item.category?.id ?? null,
      account: item.account,
      toAccount: item.toAccount,
      payer: item.payer?.id ?? null,
      shares: item.ledgerSplit?.shares.map((share) => share.share) ?? null,
    }));
  }

  describe('誰能預覽與退出（SC-K10）', () => {
    it('成員可以預覽；不是成員的 Eve 預覽、退出都 404，沒有寫入', async () => {
      const s = await scene();
      await seed(s);
      expect(
        (await preview(s.bob, s.ledgerId, all({ targetLedgerId: s.bob.ledgerId }))).status,
      ).toBe(200);
      const before = await counts();

      expect(
        (await preview(s.eve, s.ledgerId, all({ targetLedgerId: s.eve.ledgerId }))).status,
      ).toBe(404);
      expect((await leave(s.eve, s.ledgerId, all({ targetLedgerId: s.eve.ledgerId }))).status).toBe(
        404,
      );
      expect(await counts()).toEqual(before);
      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(true);
    });

    it('目標帳本不是我的 404、我是檢視者 403、等於來源帳本 400；還是成員，帳戶不變', async () => {
      const s = await scene();
      await seed(s);
      const bobBefore = await listAccounts(app, s.bob.token);
      const before = await counts();

      for (const [targetLedgerId, status] of [
        [s.eve.ledgerId, 404],
        [s.viewerLedgerId, 403],
        [s.ledgerId, 400],
      ] as const) {
        expect((await preview(s.bob, s.ledgerId, all({ targetLedgerId }))).status).toBe(status);
        expect((await leave(s.bob, s.ledgerId, all({ targetLedgerId }))).status).toBe(status);
      }

      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(true);
      expect(await listAccounts(app, s.bob.token)).toEqual(bobBefore);
      expect(await counts()).toEqual(before);
    });
  });

  describe('預覽只含自己的帳戶與對象（SC-K10）', () => {
    it('Bob 的預覽看不到 Carol 的帳戶；Carol 付的晚餐沒有帳戶影響', async () => {
      const s = await scene();
      await seed(s);
      await createCounterparty(app, s.bob, '明哥');

      const res = await preview(s.bob, s.ledgerId, all({ targetLedgerId: s.bob.ledgerId }));
      expect(res.status).toBe(200);
      const body = res.body as LedgerLeavePreview;
      const bobAccounts = (await listAccounts(app, s.bob.token)).map((account) => account.id);
      const carolAccounts = (await listAccounts(app, s.carol.token)).map((account) => account.id);

      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        for (const effect of item.accountEffects) expect(bobAccounts).toContain(effect.accountId);
      }
      for (const account of body.accounts) expect(bobAccounts).toContain(account.accountId);
      const serialized = JSON.stringify(body);
      for (const id of carolAccounts) expect(serialized).not.toContain(id);

      const dinner = body.items.find((item) => item.title === '晚餐')!;
      expect(dinner.accountEffects).toEqual([]);
      expect(dinner.paidByName).toBe('Carol');
      expect(dinner.share).toBe(75000);

      const bobCounterparties = (
        (await request(server()).get('/api/counterparties').set(auth(s.bob.token)).expect(200))
          .body as Counterparty[]
      ).map((counterparty) => counterparty.id);
      for (const carryOver of body.carryOvers) {
        if (carryOver.counterpartyId !== null) {
          expect(bobCounterparties).toContain(carryOver.counterpartyId);
        }
      }
      expect(body.carryOvers.map((carryOver) => carryOver.amount)).toEqual([75000]);
    });
  });

  describe('退出只動自己的帳（SC-K10）', () => {
    it('Carol 的帳戶、借還與看到的交易都不變；合併的交易只用 Bob 的帳戶；花蓮三日不再引用 Bob 的帳戶', async () => {
      const s = await scene();
      await seed(s);
      const carolAccounts = await listAccounts(app, s.carol.token);
      const carolTransactions = await carolView(s);
      const carolEntries = () =>
        prisma.debtEntry.count({ where: { counterparty: { ownerId: s.carol.userId } } });
      const carolProposals = () =>
        prisma.debtProposal.count({ where: { toUserId: s.carol.userId } });
      const entriesBefore = await carolEntries();
      const proposalsBefore = await carolProposals();

      expect((await leave(s.bob, s.ledgerId, all({ targetLedgerId: s.bob.ledgerId }))).status).toBe(
        204,
      );

      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(false);
      expect(await listAccounts(app, s.carol.token)).toEqual(carolAccounts);
      expect(await carolView(s)).toEqual(carolTransactions);
      expect(await carolEntries()).toBe(entriesBefore);
      expect(await carolProposals()).toBe(proposalsBefore);

      const bobAccounts = (await prisma.account.findMany({ where: { userId: s.bob.userId } })).map(
        (account) => account.id,
      );
      const merged = await prisma.transaction.findMany({
        where: { ledgerId: s.bob.ledgerId },
        select: { accountId: true, toAccountId: true },
      });
      expect(merged.length).toBeGreaterThan(0);
      for (const row of merged) {
        for (const id of [row.accountId, row.toAccountId]) {
          if (id !== null) expect(bobAccounts).toContain(id);
        }
      }
      expect(
        await prisma.transaction.count({
          where: {
            ledgerId: s.ledgerId,
            OR: [{ accountId: { in: bobAccounts } }, { toAccountId: { in: bobAccounts } }],
          },
        }),
      ).toBe(0);
    });
  });

  describe('已退出的人當付款人或結清方（SC-K4）', () => {
    it('Carol 記 Bob 付的支出與 Bob 付的結清：都不記帳戶，Bob 的帳戶不變', async () => {
      const s = await scene();
      // 直接刪成員模擬「已退出」：這條規則不依賴退出端點（plan §1.3）。
      await prisma.ledgerMember.delete({
        where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: s.bob.userId } },
      });
      const bobBefore = await listAccounts(app, s.bob.token);

      const expense = await request(server())
        .post(`/api/ledgers/${s.ledgerId}/transactions`)
        .set(auth(s.carol.token))
        .send({
          type: 'EXPENSE',
          amount: 40000,
          date: DAY,
          title: '計程車',
          categoryId: await expenseCategory(s.carol, s.ledgerId),
          payerPersonId: s.bobPersonId,
        })
        .expect(201);
      const settlement = await request(server())
        .post(`/api/ledgers/${s.ledgerId}/settlements`)
        .set(auth(s.carol.token))
        .send({
          fromPersonId: s.bobPersonId,
          toPersonId: s.carolPersonId,
          amount: 20000,
          date: DAY,
          toAccountId: s.carol.cashId,
        })
        .expect(201);

      const rows = await prisma.transaction.findMany({
        where: {
          id: { in: [(expense.body as Transaction).id, (settlement.body as Transaction).id] },
        },
        select: { accountId: true, toAccountId: true, type: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.type === 'EXPENSE')!.accountId).toBeNull();
      const transfer = rows.find((row) => row.type === 'TRANSFER')!;
      expect(transfer.accountId).toBeNull();
      expect(transfer.toAccountId).toBe(s.carol.cashId);
      expect(await listAccounts(app, s.bob.token)).toEqual(bobBefore);
    });
  });

  describe('移除成員與舊的退出端點（SC-K9 的權限）', () => {
    it('Bob 有記到他帳戶的交易：擁有者移除 409 MEMBER_HAS_TRANSACTIONS，改成檢視者 200', async () => {
      const s = await scene();
      await seed(s);

      const res = await request(server())
        .delete(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.carol.token));
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('MEMBER_HAS_TRANSACTIONS');
      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(true);

      await request(server())
        .patch(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.carol.token))
        .send({ role: 'VIEWER' })
        .expect(200);
    });

    it('Bob 只有個人借還記在這本帳本：擁有者移除照樣 409', async () => {
      const s = await scene();
      const mingge = await createCounterparty(app, s.bob, '明哥');
      await request(server())
        .post('/api/debt-entries')
        .set(auth(s.bob.token))
        .send({
          counterparty: { id: mingge.id },
          kind: 'LEND',
          amount: 50000,
          date: DAY,
          record: { ledgerId: s.ledgerId, accountId: s.bob.cashId },
        })
        .expect(201);

      const res = await request(server())
        .delete(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.carol.token));
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('MEMBER_HAS_TRANSACTIONS');
      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(true);
    });

    it('沒有帳的成員照樣可以移除', async () => {
      const s = await scene();
      await request(server())
        .delete(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.carol.token))
        .expect(204);
      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(false);
    });

    it('舊的自己退出端點：409 LEAVE_REQUIRES_MERGE，還是成員、帳戶不變', async () => {
      const s = await scene();
      await seed(s);
      const bobBefore = await listAccounts(app, s.bob.token);

      const res = await request(server())
        .delete(`/api/ledgers/${s.ledgerId}/members/${s.bob.userId}`)
        .set(auth(s.bob.token));
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('LEAVE_REQUIRES_MERGE');
      expect(await isMember(s.ledgerId, s.bob.userId)).toBe(true);
      expect(await listAccounts(app, s.bob.token)).toEqual(bobBefore);
    });
  });
});
