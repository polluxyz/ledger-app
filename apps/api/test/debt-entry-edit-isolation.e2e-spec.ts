import { INestApplication } from '@nestjs/common';
import type { Category, CreateDebtEntryResponse, DebtEntry, Paginated } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 3i 的授權與資料隔離（spec `phase-3i-debt-entry-edit.md` SC-I8）。協調者在實作前寫好，先看到紅燈。
 *
 * 3i 讓往來紀錄能改名稱、帳戶、分類，新增時也能帶分類，回應多了 `recorded`（交易現在的帳本、帳戶、
 * 名稱、分類）。這些都只能動到自己的東西：
 * - 往來紀錄只有記帳的人能改。別人（包括同一本共享帳本的成員，他看得到那筆交易）一律 404，不寫入。
 * - 帳戶只能換成自己的；別人的帳戶 404，不透露它存在。
 * - 分類只能用這筆交易所在帳本的；我看不到的帳本的分類 404，修改與新增都一樣。
 * - `recorded` 只出現在自己的往來紀錄上，內容是自己的帳本與帳戶；別人讀不到這份清單。
 *
 * 場景：Alice（OWNER）建共享帳本「花蓮三日」，Bob 是 EDITOR。Eve 不在帳本裡。
 * Alice 在共享帳本借給「明哥」500（記在她的現金）。
 */
describe('Debt entry edit — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-15T12:00:00.000Z';

  interface Scene {
    alice: Person;
    bob: Person;
    eve: Person;
    sharedLedgerId: string;
    counterpartyId: string;
    entry: DebtEntry;
  }

  async function categoryOf(who: Person, ledgerId: string, type: 'EXPENSE' | 'INCOME') {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  async function scene(): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const sharedLedgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await request(server())
      .post(`/api/ledgers/${sharedLedgerId}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'EDITOR' })
      .expect(201);
    const lent = await request(server())
      .post('/api/debt-entries')
      .set(auth(alice.token))
      .send({
        counterparty: { name: '明哥' },
        kind: 'LEND',
        amount: 50000,
        date: DAY,
        record: { ledgerId: sharedLedgerId, accountId: alice.cashId },
      })
      .expect(201);
    const body = lent.body as CreateDebtEntryResponse;
    return {
      alice,
      bob,
      eve,
      sharedLedgerId,
      counterpartyId: body.counterparty.id,
      entry: body.entries[0]!,
    };
  }

  /** 這筆往來紀錄的交易現在的樣子；每個「沒有寫入」的斷言都拿它比對。 */
  async function recordedRow(entry: DebtEntry) {
    return prisma.transaction.findUniqueOrThrow({
      where: { id: entry.transactionId! },
      select: { accountId: true, title: true, categoryId: true, ledgerId: true },
    });
  }

  describe('別人的往來紀錄', () => {
    it('Eve 改 Alice 的紀錄：名稱、帳戶、分類一律 404，沒有寫入', async () => {
      const s = await scene();
      const before = await recordedRow(s.entry);
      const eveCategory = await categoryOf(s.eve, s.eve.ledgerId, 'EXPENSE');

      for (const body of [
        { title: '偷改' },
        { accountId: s.eve.cashId },
        { categoryId: eveCategory },
        { categoryId: null },
      ]) {
        await request(server())
          .patch(`/api/debt-entries/${s.entry.id}`)
          .set(auth(s.eve.token))
          .send(body)
          .expect(404);
      }
      expect(await recordedRow(s.entry)).toEqual(before);
    });

    it('Bob 看得到共享帳本裡那筆交易，但改不了 Alice 的往來紀錄：404，沒有寫入', async () => {
      const s = await scene();
      const before = await recordedRow(s.entry);
      const sharedCategory = await categoryOf(s.bob, s.sharedLedgerId, 'EXPENSE');

      for (const body of [
        { title: 'Bob 改的' },
        { accountId: s.bob.cashId },
        { categoryId: sharedCategory },
      ]) {
        await request(server())
          .patch(`/api/debt-entries/${s.entry.id}`)
          .set(auth(s.bob.token))
          .send(body)
          .expect(404);
      }
      expect(await recordedRow(s.entry)).toEqual(before);
    });
  });

  describe('自己的往來紀錄，指到別人的東西', () => {
    it('帳戶換成別人的：404，不透露它存在，沒有寫入', async () => {
      const s = await scene();
      const before = await recordedRow(s.entry);

      for (const accountId of [s.eve.cashId, s.bob.cashId]) {
        await request(server())
          .patch(`/api/debt-entries/${s.entry.id}`)
          .set(auth(s.alice.token))
          .send({ accountId })
          .expect(404);
      }
      expect(await recordedRow(s.entry)).toEqual(before);
    });

    it('分類用我看不到的帳本的：404，沒有寫入', async () => {
      const s = await scene();
      const before = await recordedRow(s.entry);
      const eveCategory = await categoryOf(s.eve, s.eve.ledgerId, 'EXPENSE');

      await request(server())
        .patch(`/api/debt-entries/${s.entry.id}`)
        .set(auth(s.alice.token))
        .send({ categoryId: eveCategory })
        .expect(404);
      expect(await recordedRow(s.entry)).toEqual(before);
    });

    it('新增時分類用我看不到的帳本的：404，沒有新增任何紀錄', async () => {
      const s = await scene();
      const eveCategory = await categoryOf(s.eve, s.eve.ledgerId, 'EXPENSE');
      const countBefore = await prisma.debtEntry.count();

      await request(server())
        .post('/api/debt-entries')
        .set(auth(s.alice.token))
        .send({
          counterparty: { id: s.counterpartyId },
          kind: 'LEND',
          amount: 100,
          date: DAY,
          categoryId: eveCategory,
          record: { ledgerId: s.alice.ledgerId, accountId: s.alice.cashId },
        })
        .expect(404);
      expect(await prisma.debtEntry.count()).toBe(countBefore);
    });
  });

  describe('recorded', () => {
    it('只出現在自己的清單上，內容是自己的帳本與帳戶；別人讀不到這份清單', async () => {
      const s = await scene();

      const mine = await request(server())
        .get(`/api/counterparties/${s.counterpartyId}/entries`)
        .set(auth(s.alice.token))
        .expect(200);
      const entry = (mine.body as Paginated<DebtEntry>).items.find((e) => e.id === s.entry.id);
      expect(entry?.recorded).toEqual({
        ledgerId: s.sharedLedgerId,
        accountId: s.alice.cashId,
        title: null,
        categoryId: null,
        categoryIcon: null,
      });

      for (const outsider of [s.bob, s.eve]) {
        await request(server())
          .get(`/api/counterparties/${s.counterpartyId}/entries`)
          .set(auth(outsider.token))
          .expect(404);
      }
    });
  });
});
