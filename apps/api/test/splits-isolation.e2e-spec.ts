import { INestApplication } from '@nestjs/common';
import type {
  CreateSplitRequest,
  DebtProposal,
  Paginated,
  Split,
  Transaction,
} from '@ledger/shared';
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

/**
 * 分帳的授權與資料隔離（spec 3c §3.6，SC-S15、SC-S16）。協調者在實作前寫好，先看到紅燈。
 *
 * - SC-S15：分帳只屬於擁有者——別人讀、改、刪都是 404；名單、付款人、帳戶都必須是自己的；
 *   帳本權限的判斷與一般交易一致（非成員 404、VIEWER 403、封存 409）。任何一種失敗都**不能
 *   留下任何資料**：分帳、名單、交易、往來紀錄、提議都要是 0 筆。
 * - SC-S16：共享帳本的其他成員看得到分帳產生的每一筆交易（含名稱），但 `split`、`debt` 都是
 *   `null`，讀不到分帳本身；連動的對方只從提議看到名稱、種類、金額、日期，看不到總額、名單、
 *   其他人的份額、備註、帳本、帳戶。
 *
 * 計數用 raw SQL 查資料表，不依賴 Prisma Client 的 model 名稱：這份測試要能在 schema 加進
 * `Split` 之前就寫好並編譯。
 */
describe('Split isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-03T12:00:00.000Z';
  const MISSING = '00000000-0000-4000-8000-000000000000';

  async function countRows(table: string, where = 'TRUE'): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
    );
    return Number(rows[0]!.n);
  }

  /** 失敗的請求不能留下任何東西（SC-S15 最後一句）。 */
  async function expectNothingWritten(): Promise<void> {
    expect(await countRows('Split')).toBe(0);
    expect(await countRows('SplitParticipant')).toBe(0);
    expect(await countRows('DebtEntry')).toBe(0);
    expect(await countRows('DebtProposal')).toBe(0);
    expect(await countRows('Transaction')).toBe(0);
  }

  async function categoryId(who: Person, ledgerId: string, type = 'EXPENSE'): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type })
      .set(auth(who.token));
    return res.status === 200 ? (res.body as Array<{ id: string }>)[0]!.id : MISSING;
  }

  async function addMember(owner: Person, ledgerId: string, email: string, role: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email, role })
      .expect(201);
  }

  /** 晚餐 3,000 元、我付、我與 `others` 均分。 */
  async function dinner(
    who: Person,
    others: string[],
    overrides: Partial<CreateSplitRequest> = {},
  ): Promise<CreateSplitRequest> {
    return {
      type: 'EXPENSE',
      ledgerId: who.ledgerId,
      categoryId: await categoryId(who, overrides.ledgerId ?? who.ledgerId),
      total: 300000,
      date: DAY,
      title: '晚餐',
      note: '只有我看得到的備註',
      payer: null,
      accountId: who.cashId,
      method: 'EQUAL',
      participants: [{ counterpartyId: null }, ...others.map((id) => ({ counterpartyId: id }))],
      ...overrides,
    };
  }

  function postSplit(who: Person, body: CreateSplitRequest) {
    return request(server()).post('/api/splits').set(auth(who.token)).send(body);
  }

  describe('SC-S15：分帳只屬於擁有者', () => {
    it('別人讀、改、刪我的分帳都是 404，我的分帳不變', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const eve = await person(app, 'eve@example.com', 'Eve');
      const ming = await createCounterparty(app, alice, '小明');
      const created = await postSplit(alice, await dinner(alice, [ming.id])).expect(201);
      const split = created.body as Split;

      await request(server()).get(`/api/splits/${split.id}`).set(auth(eve.token)).expect(404);
      await request(server())
        .patch(`/api/splits/${split.id}`)
        .set(auth(eve.token))
        .send(await dinner(eve, [], { total: 100 }))
        .expect(404);
      await request(server()).delete(`/api/splits/${split.id}`).set(auth(eve.token)).expect(404);

      const mine = await request(server())
        .get(`/api/splits/${split.id}`)
        .set(auth(alice.token))
        .expect(200);
      expect((mine.body as Split).total).toBe(300000);
    });

    it('名單裡放別人的對象 → 404，什麼都沒寫', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const eve = await person(app, 'eve@example.com', 'Eve');
      const evesFriend = await createCounterparty(app, eve, '阿夏');

      await postSplit(alice, await dinner(alice, [evesFriend.id])).expect(404);
      await expectNothingWritten();
    });

    it('付款人放別人的對象 → 404，什麼都沒寫', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const eve = await person(app, 'eve@example.com', 'Eve');
      const evesFriend = await createCounterparty(app, eve, '阿夏');

      await postSplit(
        alice,
        await dinner(alice, [], { payer: { counterpartyId: evesFriend.id }, accountId: undefined }),
      ).expect(404);
      await expectNothingWritten();
    });

    it('用別人的帳戶 → 404，什麼都沒寫', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const eve = await person(app, 'eve@example.com', 'Eve');
      const ming = await createCounterparty(app, alice, '小明');

      await postSplit(alice, await dinner(alice, [ming.id], { accountId: eve.cashId })).expect(404);
      await expectNothingWritten();
    });

    it('記進不是成員的帳本 → 404；VIEWER → 403；封存的帳本 → 409 LEDGER_ARCHIVED', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const ming = await createCounterparty(app, alice, '小明');

      // 不是成員：bob 自己的帳本。
      await postSplit(
        alice,
        await dinner(alice, [ming.id], {
          ledgerId: bob.ledgerId,
          categoryId: await categoryId(bob, bob.ledgerId),
        }),
      ).expect(404);
      await expectNothingWritten();

      // VIEWER：bob 的共享帳本，alice 只能看。
      const shared = await createSharedLedger(app, bob.token);
      await addMember(bob, shared, 'alice@example.com', 'VIEWER');
      await postSplit(
        alice,
        await dinner(alice, [ming.id], {
          ledgerId: shared,
          categoryId: await categoryId(bob, shared),
        }),
      ).expect(403);
      await expectNothingWritten();

      // 封存：alice 自己的共享帳本。
      const archived = await createSharedLedger(app, alice.token, 'Archived');
      const archivedCategory = await categoryId(alice, archived);
      await request(server())
        .post(`/api/ledgers/${archived}/archive`)
        .set(auth(alice.token))
        .expect((res) => expect([200, 201, 204]).toContain(res.status));
      const res = await postSplit(
        alice,
        await dinner(alice, [ming.id], { ledgerId: archived, categoryId: archivedCategory }),
      ).expect(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');
      await expectNothingWritten();
    });

    it('新名字的對象不能從分帳端點建立：名單只收 id', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const body = (await dinner(alice, [])) as unknown as Record<string, unknown>;
      body.participants = [{ counterpartyId: null }, { name: '新朋友' }];

      await request(server()).post('/api/splits').set(auth(alice.token)).send(body).expect(400);
      expect(await countRows('Counterparty')).toBe(0);
      await expectNothingWritten();
    });
  });

  describe('SC-S16：帳本成員與連動的對方看不到分帳', () => {
    it('共享帳本的其他成員看得到每一筆交易與名稱，但 split、debt 都是 null，也讀不到分帳', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      const shared = await createSharedLedger(app, alice.token);
      await addMember(alice, shared, 'bob@example.com', 'EDITOR');
      const ming = await createCounterparty(app, alice, '小明');
      const hua = await createCounterparty(app, alice, '小華');
      const mei = await createCounterparty(app, alice, '阿美');

      const created = await postSplit(
        alice,
        await dinner(alice, [ming.id, hua.id, mei.id], {
          ledgerId: shared,
          categoryId: await categoryId(alice, shared),
        }),
      ).expect(201);
      const split = created.body as Split;

      const list = await request(server())
        .get(`/api/ledgers/${shared}/transactions`)
        .query({ limit: 100 })
        .set(auth(bob.token))
        .expect(200);
      const items = (list.body as Paginated<Transaction>).items;
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(item.title).toBe('晚餐');
        expect(item.split).toBeNull();
        expect(item.debt).toBeNull();
      }

      await request(server()).get(`/api/splits/${split.id}`).set(auth(bob.token)).expect(404);

      // 擁有者自己看同一本帳本：合併成一列，帶著 split（SC-S14 的對照組）。
      const own = await request(server())
        .get(`/api/ledgers/${shared}/transactions`)
        .query({ limit: 100 })
        .set(auth(alice.token))
        .expect(200);
      const ownItems = (own.body as Paginated<Transaction>).items;
      expect(ownItems).toHaveLength(1);
      expect(ownItems[0]!.split?.id).toBe(split.id);
    });

    it('連動的小明收到的提議只有名稱、種類、金額、日期', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const ming = await person(app, 'ming@example.com', 'Ming');
      const { aCounterpartyId } = await linkPair(app, alice, ming, '小明', '阿A');
      const hua = await createCounterparty(app, alice, '小華');

      await postSplit(alice, await dinner(alice, [aCounterpartyId, hua.id])).expect(201);

      const incoming: DebtProposal[] = await proposals(app, ming, 'incoming', 'PENDING');
      expect(incoming).toHaveLength(1);
      const proposal = incoming[0]!;
      expect(proposal.entryKind).toBe('PAID_FOR_ME');
      expect(proposal.amount).toBe(100000);
      expect(proposal.title).toBe('晚餐');
      expect(proposal.date).toBe(DAY);

      const body = JSON.stringify(proposal);
      for (const leaked of ['300000', '只有我看得到的備註', '小華', alice.ledgerId, alice.cashId]) {
        expect(body).not.toContain(leaked);
      }
      for (const key of ['total', 'participants', 'note', 'ledgerId', 'accountId', 'splitId']) {
        expect(proposal).not.toHaveProperty(key);
      }
    });
  });
});
