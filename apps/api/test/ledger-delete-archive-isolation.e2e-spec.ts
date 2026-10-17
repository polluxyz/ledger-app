import { INestApplication } from '@nestjs/common';
import type {
  Category,
  CreateDebtEntryResponse,
  DebtEntry,
  DebtProposal,
  LedgerRemovalPreview,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, linkPair, person, proposals, type Person } from './linking-utils';

/**
 * 3j 的授權與資料隔離（spec `phase-3j-ledger-delete-archive.md` SC-J1、SC-J6、SC-J2 的權限、
 * SC-J4）。協調者在實作前寫好，先看到紅燈。
 *
 * - 借還紀錄的每一種寫入（改金額、改備註、撤銷、接受對方的修改與撤銷）都要有那筆交易所在帳本的
 *   寫入權：檢視者 403、封存 409。拒絕對方的提議不動我的帳本，照樣可以。
 * - 取消封存與刪除預覽只有擁有者能用；不是成員 404，不透露帳本存在。
 * - 預覽只含呼叫者自己的帳戶與對象；不能刪時不回任何帳戶，不洩漏別人的餘額。
 * - 刪除私人帳本撤銷借還時，只撤銷自己的往來紀錄；對方那一筆照舊在，只收到撤銷提議。
 * - 刪除不能改到別人的餘額：帳本裡有記到別人帳戶（含臨時帳戶）的交易就不能刪。
 *
 * 場景：Carol 擁有共享帳本「花蓮三日」，Bob 是 EDITOR，Eve 不在帳本裡。Alice 與 Bob 已連動。
 * 全部走 HTTP，只在斷言「沒有寫入」時直接讀資料庫。
 */
describe('Ledger delete and archive — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-17T12:00:00.000Z';
  const HUALIEN = '花蓮三日';

  interface Scene {
    alice: Person;
    bob: Person;
    carol: Person;
    eve: Person;
    sharedLedgerId: string;
    aliceSide: string;
    bobSide: string;
  }

  async function scene(): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const sharedLedgerId = await createSharedLedger(app, carol.token, HUALIEN);
    await request(server())
      .post(`/api/ledgers/${sharedLedgerId}/members`)
      .set(auth(carol.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const { aCounterpartyId, bCounterpartyId } = await linkPair(app, alice, bob);
    return {
      alice,
      bob,
      carol,
      eve,
      sharedLedgerId,
      aliceSide: aCounterpartyId,
      bobSide: bCounterpartyId,
    };
  }

  async function incoming(who: Person): Promise<DebtProposal> {
    return (await proposals(app, who, 'incoming', 'PENDING'))[0]!;
  }

  /** Alice 借 Bob 500，Bob 接受並記進共享帳本。回傳兩邊的紀錄。 */
  async function bobRecordsInShared(
    s: Scene,
  ): Promise<{ aliceEntry: DebtEntry; bobEntry: DebtEntry }> {
    const lent = await request(server())
      .post('/api/debt-entries')
      .set(auth(s.alice.token))
      .send({
        counterparty: { id: s.aliceSide },
        kind: 'LEND',
        amount: 50000,
        date: DAY,
        record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
      })
      .expect(201);
    await request(server())
      .post(`/api/debt-proposals/${(await incoming(s.bob)).id}/accept`)
      .set(auth(s.bob.token))
      .send({ record: { ledgerId: s.sharedLedgerId, accountId: s.bob.cashId } })
      .expect(200);
    const bobEntry = await prisma.debtEntry.findFirstOrThrow({
      where: { counterpartyId: s.bobSide, deletedAt: null },
    });
    return {
      aliceEntry: (lent.body as CreateDebtEntryResponse).entries[0]!,
      bobEntry: { id: bobEntry.id } as DebtEntry,
    };
  }

  /** 每個「沒有寫入」的斷言都拿它比對。 */
  async function snapshot(entryId: string) {
    const entry = await prisma.debtEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { delta: true, note: true, deletedAt: true, transactionId: true },
    });
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: entry.transactionId! },
      select: { amount: true, deletedAt: true, ledgerId: true, accountId: true },
    });
    return { entry, transaction };
  }

  async function setRole(s: Scene, role: 'VIEWER' | 'EDITOR') {
    await request(server())
      .patch(`/api/ledgers/${s.sharedLedgerId}/members/${s.bob.userId}`)
      .set(auth(s.carol.token))
      .send({ role })
      .expect(200);
  }

  async function archive(s: Scene) {
    await request(server())
      .post(`/api/ledgers/${s.sharedLedgerId}/archive`)
      .set(auth(s.carol.token))
      .expect(201);
  }

  describe('借還紀錄的寫入權（SC-J1）', () => {
    it.each([
      { label: '檢視者', status: 403, restrict: (s: Scene) => setRole(s, 'VIEWER') },
      { label: '封存', status: 409, restrict: (s: Scene) => archive(s) },
    ])('$label：改金額、改備註、撤銷都擋下，沒有寫入', async ({ status, restrict }) => {
      const s = await scene();
      const { bobEntry } = await bobRecordsInShared(s);
      await restrict(s);
      const before = await snapshot(bobEntry.id);

      for (const body of [{ amount: 60000 }, { note: '改備註' }]) {
        const res = await request(server())
          .patch(`/api/debt-entries/${bobEntry.id}`)
          .set(auth(s.bob.token))
          .send(body);
        expect(res.status).toBe(status);
        if (status === 409) {
          expect((res.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');
        }
      }
      const removed = await request(server())
        .delete(`/api/debt-entries/${bobEntry.id}`)
        .set(auth(s.bob.token));
      expect(removed.status).toBe(status);
      expect(await snapshot(bobEntry.id)).toEqual(before);
    });

    it.each([
      { label: '檢視者', status: 403, restrict: (s: Scene) => setRole(s, 'VIEWER') },
      { label: '封存', status: 409, restrict: (s: Scene) => archive(s) },
    ])('$label：接受對方的修改、撤銷都擋下；拒絕照樣可以', async ({ status, restrict }) => {
      const s = await scene();
      const { aliceEntry, bobEntry } = await bobRecordsInShared(s);
      await restrict(s);
      const before = await snapshot(bobEntry.id);

      await request(server())
        .patch(`/api/debt-entries/${aliceEntry.id}`)
        .set(auth(s.alice.token))
        .send({ amount: 60000 })
        .expect(200);
      const amend = await incoming(s.bob);
      expect(amend.type).toBe('AMEND');
      const acceptAmend = await request(server())
        .post(`/api/debt-proposals/${amend.id}/accept`)
        .set(auth(s.bob.token))
        .send({});
      expect(acceptAmend.status).toBe(status);
      expect(await snapshot(bobEntry.id)).toEqual(before);
      expect((await incoming(s.bob)).id).toBe(amend.id);

      await request(server())
        .post(`/api/debt-proposals/${amend.id}/decline`)
        .set(auth(s.bob.token))
        .expect(200);

      await request(server())
        .delete(`/api/debt-entries/${aliceEntry.id}`)
        .set(auth(s.alice.token))
        .expect(204);
      const deletion = await incoming(s.bob);
      expect(deletion.type).toBe('DELETE');
      const acceptDelete = await request(server())
        .post(`/api/debt-proposals/${deletion.id}/accept`)
        .set(auth(s.bob.token))
        .send({});
      expect(acceptDelete.status).toBe(status);
      expect(await snapshot(bobEntry.id)).toEqual(before);
      expect((await incoming(s.bob)).id).toBe(deletion.id);
    });
  });

  describe('取消封存（SC-J2 的權限）', () => {
    it('編輯者 403、不是成員 404；帳本照舊封存', async () => {
      const s = await scene();
      await archive(s);

      await request(server())
        .post(`/api/ledgers/${s.sharedLedgerId}/unarchive`)
        .set(auth(s.bob.token))
        .expect(403);
      await request(server())
        .post(`/api/ledgers/${s.sharedLedgerId}/unarchive`)
        .set(auth(s.eve.token))
        .expect(404);
      const ledger = await prisma.ledger.findUniqueOrThrow({ where: { id: s.sharedLedgerId } });
      expect(ledger.archivedAt).not.toBeNull();
    });
  });

  describe('刪除預覽（SC-J6）', () => {
    async function preview(who: Person, ledgerId: string) {
      return request(server()).get(`/api/ledgers/${ledgerId}/removal-preview`).set(auth(who.token));
    }

    it('編輯者 403、不是成員 404', async () => {
      const s = await scene();
      expect((await preview(s.bob, s.sharedLedgerId)).status).toBe(403);
      expect((await preview(s.eve, s.sharedLedgerId)).status).toBe(404);
    });

    it('不能刪時不回任何帳戶，看不到 Bob 的餘額', async () => {
      const s = await scene();
      const categories = await request(server())
        .get(`/api/ledgers/${s.sharedLedgerId}/categories`)
        .query({ type: 'EXPENSE' })
        .set(auth(s.bob.token))
        .expect(200);
      await request(server())
        .post(`/api/ledgers/${s.sharedLedgerId}/transactions`)
        .set(auth(s.bob.token))
        .send({
          type: 'EXPENSE',
          amount: 80000,
          date: DAY,
          categoryId: (categories.body as Category[])[0]!.id,
          accountId: s.bob.cashId,
        })
        .expect(201);

      const res = await preview(s.carol, s.sharedLedgerId);
      expect(res.status).toBe(200);
      const body = res.body as LedgerRemovalPreview;
      expect(body.delete).toEqual({ allowed: false, blockedBy: 'HAS_OTHERS_TRANSACTIONS' });
      expect(body.accounts).toEqual([]);
      expect(body.counterparties).toEqual([]);
    });

    it('私人帳本的預覽只含自己的帳戶與對象', async () => {
      const s = await scene();
      await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { id: s.aliceSide },
          kind: 'LEND',
          amount: 50000,
          date: DAY,
          record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
        })
        .expect(201);

      const res = await preview(s.alice, s.alice.ledgerId);
      expect(res.status).toBe(200);
      const body = res.body as LedgerRemovalPreview;
      const aliceAccounts = (await listAccounts(app, s.alice.token)).map((account) => account.id);
      expect(body.accounts.length).toBeGreaterThan(0);
      for (const account of body.accounts) {
        expect(aliceAccounts).toContain(account.accountId);
      }
      expect(body.counterparties.map((c) => c.counterpartyId)).toEqual([s.aliceSide]);
    });
  });

  describe('刪除私人帳本撤銷借還（SC-J6）', () => {
    it('只撤銷 Alice 自己的往來紀錄；Bob 那筆照舊在，只收到撤銷提議', async () => {
      const s = await scene();
      const trip = await request(server())
        .post('/api/ledgers')
        .set(auth(s.alice.token))
        .send({ name: '日本旅遊' })
        .expect(201);
      const tripId = (trip.body as { id: string }).id;
      await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { id: s.aliceSide },
          kind: 'LEND',
          amount: 50000,
          date: DAY,
          record: { ledgerId: tripId, accountId: s.alice.cashId },
        })
        .expect(201);
      await request(server())
        .post(`/api/debt-proposals/${(await incoming(s.bob)).id}/accept`)
        .set(auth(s.bob.token))
        .send({ record: { ledgerId: s.bob.ledgerId, accountId: s.bob.cashId } })
        .expect(200);
      const bobEntry = await prisma.debtEntry.findFirstOrThrow({
        where: { counterpartyId: s.bobSide },
      });
      const bobBefore = await snapshot(bobEntry.id);

      await request(server())
        .delete(`/api/ledgers/${tripId}`)
        .query({ confirm: '日本旅遊', withdrawDebts: true })
        .set(auth(s.alice.token))
        .expect(204);

      expect(await snapshot(bobEntry.id)).toEqual(bobBefore);
      expect((await incoming(s.bob)).type).toBe('DELETE');
    });
  });

  describe('記到別人帳戶的交易擋刪除（SC-J4）', () => {
    it('Carol 記一筆 Bob 付的支出：刪除 409，Bob 的帳戶餘額不變', async () => {
      const s = await scene();
      const categories = await request(server())
        .get(`/api/ledgers/${s.sharedLedgerId}/categories`)
        .query({ type: 'EXPENSE' })
        .set(auth(s.carol.token))
        .expect(200);
      const bobPerson = await prisma.ledgerPerson.findUniqueOrThrow({
        where: { ledgerId_userId: { ledgerId: s.sharedLedgerId, userId: s.bob.userId } },
      });
      await request(server())
        .post(`/api/ledgers/${s.sharedLedgerId}/transactions`)
        .set(auth(s.carol.token))
        .send({
          type: 'EXPENSE',
          amount: 300000,
          date: DAY,
          categoryId: (categories.body as Category[])[0]!.id,
          payerPersonId: bobPerson.id,
        })
        .expect(201);
      const bobBefore = await listAccounts(app, s.bob.token);

      const res = await request(server())
        .delete(`/api/ledgers/${s.sharedLedgerId}`)
        .query({ confirm: HUALIEN })
        .set(auth(s.carol.token));
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('LEDGER_HAS_OTHERS_TRANSACTIONS');
      expect(await listAccounts(app, s.bob.token)).toEqual(bobBefore);

      const preview = await request(server())
        .get(`/api/ledgers/${s.sharedLedgerId}/removal-preview`)
        .set(auth(s.carol.token))
        .expect(200);
      expect((preview.body as LedgerRemovalPreview).delete).toEqual({
        allowed: false,
        blockedBy: 'HAS_OTHERS_TRANSACTIONS',
      });
    });
  });
});
