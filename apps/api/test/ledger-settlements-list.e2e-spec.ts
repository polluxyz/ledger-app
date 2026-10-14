import { INestApplication } from '@nestjs/common';
import type {
  Account,
  CreateSettlementRequest,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 共享帳本結清清單（3g spec `phase-3g-debts-inline.md` SC-G6）的 e2e：
 * `GET /ledgers/{id}/settlements` 與 `GET /ledger-groups?hasSettlements=true`。
 *
 * 場景：Alice（OWNER）建「花蓮三日」，Bob、Carol 是 EDITOR，Eve 在外面有一本自己的
 * 共享帳本。帳本裡記三筆結清後撤銷最新一筆，剩下的兩筆用來驗：新到舊、分頁、
 * 退出後的範圍、正式帳戶遮蔽、本人臨時帳戶可見，以及 hasSettlements 的過濾與 settlementCount。
 * 授權與資料隔離的完整清單在 `debts-inline-isolation.e2e-spec.ts`（SC-G7）。
 */
describe('Ledger settlements list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY1 = '2026-10-11T12:00:00.000Z';
  const DAY2 = '2026-10-12T12:00:00.000Z';
  const DAY3 = '2026-10-13T12:00:00.000Z';

  interface Scene {
    alice: Person;
    bob: Person;
    carol: Person;
    eve: Person;
    ledgerId: string;
    quietLedgerId: string;
    eveLedgerId: string;
    people: { Alice: LedgerPerson; Bob: LedgerPerson; Carol: LedgerPerson };
    bobToCarol: Transaction;
    bobToAlice: Transaction;
  }

  async function addMember(owner: Person, ledgerId: string, email: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email, role: 'EDITOR' })
      .expect(201);
  }

  async function listPeople(who: Person, ledgerId: string): Promise<LedgerPerson[]> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerPerson[];
  }

  async function postSettlement(who: Person, ledgerId: string, body: CreateSettlementRequest) {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as Transaction;
  }

  async function settlementIdFor(transactionId: string): Promise<string> {
    const row = await prisma.ledgerSettlement.findUnique({
      where: { transactionId },
      select: { id: true },
    });
    if (!row) throw new Error('Expected a LedgerSettlement row for the transaction.');
    return row.id;
  }

  async function scene(): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await addMember(alice, ledgerId, bob.email);
    await addMember(alice, ledgerId, carol.email);
    // 沒有結清的帳本：證明 hasSettlements 的過濾不是「本來就看不到」。
    const quietLedgerId = await createSharedLedger(app, alice.token, '沒有結清的帳本');
    const eveLedgerId = await createSharedLedger(app, eve.token, 'Eve 的帳本');

    const people = await listPeople(alice, ledgerId);
    const personOf = (name: string) => people.find((p) => p.name === name)!;

    const bobToCarol = await postSettlement(bob, ledgerId, {
      fromPersonId: personOf('Bob').id,
      toPersonId: personOf('Carol').id,
      amount: 10000,
      date: DAY1,
      fromAccountId: bob.cashId,
    });
    const bobToAlice = await postSettlement(bob, ledgerId, {
      fromPersonId: personOf('Bob').id,
      toPersonId: personOf('Alice').id,
      amount: 20000,
      date: DAY2,
      fromAccountId: bob.cashId,
    });
    // 第三筆記成最新，再撤銷——剩下的清單必須把它當不存在。
    const aliceToCarol = await postSettlement(alice, ledgerId, {
      fromPersonId: personOf('Alice').id,
      toPersonId: personOf('Carol').id,
      amount: 30000,
      date: DAY3,
      fromAccountId: alice.cashId,
    });
    await request(server())
      .delete(`/api/ledgers/${ledgerId}/settlements/${await settlementIdFor(aliceToCarol.id)}`)
      .set(auth(alice.token))
      .expect(204);

    return {
      alice,
      bob,
      carol,
      eve,
      ledgerId,
      quietLedgerId,
      eveLedgerId,
      people: { Alice: personOf('Alice'), Bob: personOf('Bob'), Carol: personOf('Carol') },
      bobToCarol,
      bobToAlice,
    };
  }

  async function temporaryAccountId(who: Person): Promise<string> {
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: who.userId, isTemporary: true },
      select: { id: true },
    });
    return account.id;
  }

  async function settlementsAs(
    who: Person,
    ledgerId: string,
    query: Record<string, number> = {},
  ): Promise<Paginated<Transaction>> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/settlements`)
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return res.body as Paginated<Transaction>;
  }

  async function groupsAs(who: Person, query: Record<string, string> = {}): Promise<LedgerGroup[]> {
    const res = await request(server())
      .get('/api/ledger-groups')
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerGroup[];
  }

  it('lists the remaining settlements newest-first with the right total', async () => {
    const s = await scene();
    const page = await settlementsAs(s.alice, s.ledgerId);

    expect(page.items.map((t) => t.id)).toEqual([s.bobToAlice.id, s.bobToCarol.id]);
    expect(page.total).toBe(2);
    expect(page).toMatchObject({ page: 1, limit: 20 });
    for (const item of page.items) {
      expect(item.type).toBe('TRANSFER');
      expect(item.settlement).not.toBeNull();
    }
    expect(page.items[0]!.settlement).toMatchObject({
      from: { id: s.people.Bob.id },
      to: { id: s.people.Alice.id },
    });
    expect(page.items[1]!.settlement).toMatchObject({
      from: { id: s.people.Bob.id },
      to: { id: s.people.Carol.id },
    });
  });

  it('walks the same two items across pages with limit=1', async () => {
    const s = await scene();
    const first = await settlementsAs(s.alice, s.ledgerId, { limit: 1, page: 1 });
    const second = await settlementsAs(s.alice, s.ledgerId, { limit: 1, page: 2 });
    const third = await settlementsAs(s.alice, s.ledgerId, { limit: 1, page: 3 });

    expect(first).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(second).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect(first.items.map((t) => t.id)).toEqual([s.bobToAlice.id]);
    expect(second.items.map((t) => t.id)).toEqual([s.bobToCarol.id]);
    expect(third.items).toEqual([]);
    expect(third.total).toBe(2);
  });

  it('masks another member’s settlement accounts exactly like the transaction list', async () => {
    const s = await scene();
    const asAlice = await settlementsAs(s.alice, s.ledgerId);
    const asBob = await settlementsAs(s.bob, s.ledgerId);

    // Alice 看不到 Bob 的正式帳戶，也看不到 Carol 的帳戶；她自己承接的收款在臨時帳戶，仍可辨認。
    const bobToAliceAsAlice = asAlice.items.find((item) => item.id === s.bobToAlice.id)!;
    const bobToCarolAsAlice = asAlice.items.find((item) => item.id === s.bobToCarol.id)!;
    expect(bobToAliceAsAlice.account).toBeNull();
    expect(bobToAliceAsAlice.toAccount).toMatchObject({ id: await temporaryAccountId(s.alice) });
    expect(bobToCarolAsAlice.account).toBeNull();
    expect(bobToCarolAsAlice.toAccount).toBeNull();
    for (const item of asBob.items) {
      expect(item.account).toMatchObject({ id: s.bob.cashId });
      expect(item.toAccount).toBeNull();
    }

    // 同一筆在交易列表的遮蔽結果必須一致——同一份轉換，不能有第二套規則。
    const listRes = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions`)
      .query({ type: 'TRANSFER', limit: 100 })
      .set(auth(s.alice.token))
      .expect(200);
    const listed = (listRes.body as Paginated<Transaction>).items;
    const listedBobToAlice = listed.find((t) => t.id === s.bobToAlice.id)!;
    expect(listedBobToAlice.account).toBeNull();
    expect(listedBobToAlice.settlement).toEqual(asAlice.items[0]!.settlement);

    // Bob 的帳戶確實存在且屬於他——遮蔽不是因為資料沒寫進去。
    const bobAccounts: Account[] = await request(server())
      .get('/api/accounts')
      .set(auth(s.bob.token))
      .expect(200)
      .then((res) => res.body as Account[]);
    expect(bobAccounts.map((a) => a.id)).toContain(s.bob.cashId);
  });

  it('returns only settlements involving the viewer after they leave', async () => {
    const s = await scene();
    await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/members/${s.carol.userId}`)
      .set(auth(s.carol.token))
      .expect(204);

    const all = await settlementsAs(s.carol, s.ledgerId, { limit: 100 });
    expect(all.items.map((t) => t.id)).toEqual([s.bobToCarol.id]);
    expect(all.total).toBe(1);

    // 分頁不能放寬範圍：每一頁的 total 都還是 1。
    const paged = await settlementsAs(s.carol, s.ledgerId, { limit: 1, page: 1 });
    expect(paged).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(paged.items.map((t) => t.id)).toEqual([s.bobToCarol.id]);
  });

  it('filters ledger-groups by hasSettlements and counts what the viewer can see', async () => {
    const s = await scene();

    // 對照組：不帶參數時兩本帳本都在（行為與現行相同，也不帶 settlementCount）。
    const plain = await groupsAs(s.alice);
    expect(plain.map((g) => g.ledger.id).sort()).toEqual([s.ledgerId, s.quietLedgerId].sort());
    for (const group of plain) {
      expect('settlementCount' in group).toBe(false);
    }

    // 帶 hasSettlements：只有看得到結清的帳本出現，撤銷的那筆不計入。
    const aliceGroups = await groupsAs(s.alice, { hasSettlements: 'true' });
    expect(aliceGroups.map((g) => g.ledger.id)).toEqual([s.ledgerId]);
    expect(aliceGroups[0]!.settlementCount).toBe(2);

    // 沒有結清的帳本（別人的、自己的都一樣）不會出現。
    const eveGroups = await groupsAs(s.eve, { hasSettlements: 'true' });
    expect(eveGroups.map((g) => g.ledger.id)).toEqual([]);

    // 退出後：帳本還在清單（不受「已退出只在還有轉帳時列」限制），筆數只算我是任一方的。
    await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/members/${s.carol.userId}`)
      .set(auth(s.carol.token))
      .expect(204);
    const carolGroups = await groupsAs(s.carol, { hasSettlements: 'true' });
    expect(carolGroups.map((g) => g.ledger.id)).toEqual([s.ledgerId]);
    expect(carolGroups[0]!.ledger.left).toBe(true);
    expect(carolGroups[0]!.settlementCount).toBe(1);
  });
});
