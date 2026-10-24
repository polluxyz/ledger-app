import { INestApplication } from '@nestjs/common';
import type { Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 新增交易時順便建分類（`phase-4a-ai-new-category.md` 決策 286～290）的授權與原子性。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - SC-P15：帶 `newCategoryName` 新增交易，權限同一般新增交易——別人的帳本 404、檢視者 403、
 *   封存 409。被拒絕時那本帳本的分類一個都沒多。每條配正向對照：我的個人帳本、我是 EDITOR 的
 *   共享帳本都 201，而且真的建出分類、交易掛在它上面。
 * - SC-P14 第 4 項：建分類與新增交易在同一個資料庫交易。後面的檢查失敗（臨時帳戶、分帳金額
 *   對不上）→ 400，分類不留下。個人與共享帳本各驗一次；分帳那條的失敗點在分類檢查之後，
 *   專門擋「先建分類、再失敗卻沒回滾」。
 *
 * 策略：全部走 HTTP；分類數與臨時帳戶 id 直接查資料庫，因為檢視者、陌生人讀不到分類清單。
 *
 * 場景：Bob 是使用者。Carol 擁有 3 本共享帳本：「花蓮三日」Bob 是 EDITOR、「公司聚餐」Bob 是
 * VIEWER、「去年墾丁」Bob 是 EDITOR 但已封存。Eve 和 Bob 沒有任何共同帳本。
 */
describe('Create transaction with a new category — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DATE = '2026-10-24T12:00:00.000Z';
  const NAME = '日用品';

  interface Scene {
    bob: Person;
    carol: Person;
    eve: Person;
    tripId: string;
    viewerId: string;
    archivedId: string;
    bobTemporaryId: string;
  }

  async function addMember(owner: Person, ledgerId: string, member: Person, role: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email: member.email, role })
      .expect(201);
  }

  async function scene(): Promise<Scene> {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const tripId = await createSharedLedger(app, carol.token, '花蓮三日');
    const viewerId = await createSharedLedger(app, carol.token, '公司聚餐');
    const archivedId = await createSharedLedger(app, carol.token, '去年墾丁');
    await addMember(carol, tripId, bob, 'EDITOR');
    await addMember(carol, viewerId, bob, 'VIEWER');
    await addMember(carol, archivedId, bob, 'EDITOR');
    await request(server())
      .post(`/api/ledgers/${archivedId}/archive`)
      .set(auth(carol.token))
      .expect(201);

    const bobTemporary = await prisma.account.findFirstOrThrow({
      where: { userId: bob.userId, isTemporary: true },
    });

    return { bob, carol, eve, tripId, viewerId, archivedId, bobTemporaryId: bobTemporary.id };
  }

  function create(who: Person, ledgerId: string, body: Record<string, unknown> = {}) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send({
        type: 'EXPENSE',
        amount: 18900,
        date: DATE,
        title: '衛生紙',
        newCategoryName: NAME,
        accountId: who.cashId,
        ...body,
      });
  }

  const categoryCount = (ledgerId: string) => prisma.category.count({ where: { ledgerId } });
  const proposedCount = (ledgerId: string) =>
    prisma.category.count({ where: { ledgerId, name: NAME } });

  describe('SC-P15: the ledger must be writable, and a rejected request creates no category', () => {
    it.each([
      ['my own personal ledger', (s: Scene) => s.bob.ledgerId],
      ['a shared ledger where I am EDITOR', (s: Scene) => s.tripId],
    ] as const)(
      'creates the category and the transaction in %s (positive control)',
      async (_label, ledgerOf) => {
        const s = await scene();
        const ledgerId = ledgerOf(s);
        const before = await categoryCount(ledgerId);

        const res = await create(s.bob, ledgerId).expect(201);

        expect(await categoryCount(ledgerId)).toBe(before + 1);
        const created = await prisma.category.findFirstOrThrow({
          where: { ledgerId, type: 'EXPENSE', name: NAME },
        });
        expect((res.body as Transaction).category?.id).toBe(created.id);
      },
    );

    // 每列：呼叫者與目標帳本。「不在其中的共享帳本」由 Eve 對 Bob 能寫的「花蓮三日」送出。
    it.each([
      ['someone else’s personal ledger', (s: Scene) => [s.bob, s.eve.ledgerId], 404, 'NOT_FOUND'],
      ['a shared ledger I am not in', (s: Scene) => [s.eve, s.tripId], 404, 'NOT_FOUND'],
      ['a ledger where I am VIEWER', (s: Scene) => [s.bob, s.viewerId], 403, 'FORBIDDEN'],
      ['an archived ledger', (s: Scene) => [s.bob, s.archivedId], 409, 'LEDGER_ARCHIVED'],
    ] as const)(
      'rejects %s and leaves its categories untouched',
      async (_label, target, status, code) => {
        const s = await scene();
        const [who, ledgerId] = target(s) as [Person, string];
        const before = await categoryCount(ledgerId);

        const res = await create(who, ledgerId).expect(status);

        expect((res.body as { errorCode: string }).errorCode).toBe(code);
        expect(await categoryCount(ledgerId)).toBe(before);
        expect(await proposedCount(ledgerId)).toBe(0);
      },
    );
  });

  describe('SC-P14 #4: a failed write leaves no category behind', () => {
    it.each([
      ['my personal ledger', (s: Scene) => s.bob.ledgerId],
      ['a shared ledger', (s: Scene) => s.tripId],
    ] as const)('rolls back when the account is not selectable in %s', async (_label, ledgerOf) => {
      const s = await scene();
      const ledgerId = ledgerOf(s);
      const before = await categoryCount(ledgerId);

      const res = await create(s.bob, ledgerId, { accountId: s.bobTemporaryId }).expect(400);

      expect((res.body as { errorCode: string }).errorCode).toBe(
        'TEMPORARY_ACCOUNT_NOT_SELECTABLE',
      );
      expect(await categoryCount(ledgerId)).toBe(before);
      expect(await proposedCount(ledgerId)).toBe(0);
    });

    it('rolls back when the ledger split fails after the category step', async () => {
      const s = await scene();
      const people = await prisma.ledgerPerson.findMany({ where: { ledgerId: s.tripId } });
      const [bobPersonId, carolPersonId] = [s.bob, s.carol].map(
        (member) => people.find((p) => p.userId === member.userId)!.id,
      );
      const before = await categoryCount(s.tripId);

      // 份額加總 100 元，交易 189 元：分帳檢查排在分類之後，失敗時分類也要一起消失。
      const res = await create(s.bob, s.tripId, {
        ledgerSplit: {
          method: 'AMOUNT',
          shares: [
            { personId: bobPersonId, amount: 5000 },
            { personId: carolPersonId, amount: 5000 },
          ],
        },
      }).expect(400);

      expect((res.body as { errorCode: string }).errorCode).toBe('SPLIT_SUM_MISMATCH');
      expect(await categoryCount(s.tripId)).toBe(before);
      expect(await proposedCount(s.tripId)).toBe(0);
    });
  });
});
