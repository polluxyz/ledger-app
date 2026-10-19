import { INestApplication } from '@nestjs/common';
import type {
  ApiErrorResponse,
  Counterparty,
  CreateSettlementRequest,
  CreateTransactionRequest,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, linkPair, person, type Person } from './linking-utils';

/**
 * 3f 的授權與資料隔離（spec `phase-3f-unified-debts.md` 決策 146、151，SC-F9、SC-F10）。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - 3k SC-K3 取代 SC-F9 的唯讀：退出後帳本、交易、結清與指向一律 404。
 *   從沒加入過的人跟以前一樣全是 404，查詢參數不能恢復存取權。
 * - SC-F10（指向）：指向只有本人讀得到；帶別人的對象、我沒參與過的帳本、別本帳本的人一律 404，
 *   不透露存在。
 *
 * 場景：Alice（OWNER）建連動的共享帳本「花蓮三日」，Bob、Carol 是 EDITOR。Eve 不在帳本裡，
 * 有一本自己的共享帳本。退出的是 Carol。
 */
describe('Unified debts isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-06T12:00:00.000Z';

  interface Scene {
    alice: Person;
    bob: Person;
    carol: Person;
    eve: Person;
    ledgerId: string;
    eveLedgerId: string;
    people: Record<'Alice' | 'Bob' | 'Carol', LedgerPerson>;
    evePerson: LedgerPerson;
    expenseCategoryId: string;
  }

  async function addMember(owner: Person, ledgerId: string, email: string, role: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email, role })
      .expect(201);
  }

  async function listPeople(who: Person, ledgerId: string): Promise<LedgerPerson[]> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(who.token))
      .expect(200);
    return res.body as LedgerPerson[];
  }

  async function firstCategoryId(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Array<{ id: string }>)[0]!.id;
  }

  async function scene(): Promise<Scene> {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await addMember(alice, ledgerId, bob.email, 'EDITOR');
    await addMember(alice, ledgerId, carol.email, 'EDITOR');
    const eveLedgerId = await createSharedLedger(app, eve.token, 'Eve 的帳本');

    const listed = await listPeople(alice, ledgerId);
    const byName = (name: string) => {
      const found = listed.find((p) => p.name === name);
      if (!found) throw new Error(`no LedgerPerson named ${name}`);
      return found;
    };
    const [evePerson] = await listPeople(eve, eveLedgerId);

    return {
      alice,
      bob,
      carol,
      eve,
      ledgerId,
      eveLedgerId,
      people: { Alice: byName('Alice'), Bob: byName('Bob'), Carol: byName('Carol') },
      evePerson: evePerson!,
      expenseCategoryId: await firstCategoryId(alice, ledgerId),
    };
  }

  function expense(
    s: Scene,
    payer: Person,
    amount: number,
    personIds: string[],
    title: string,
  ): CreateTransactionRequest {
    return {
      type: 'EXPENSE',
      amount,
      date: DAY,
      categoryId: s.expenseCategoryId,
      title,
      accountId: payer.cashId,
      ledgerSplit: { method: 'EQUAL', shares: personIds.map((personId) => ({ personId })) },
    };
  }

  async function postTransaction(
    who: Person,
    ledgerId: string,
    body: CreateTransactionRequest,
  ): Promise<Transaction> {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as Transaction;
  }

  async function postSettlement(
    who: Person,
    ledgerId: string,
    body: CreateSettlementRequest,
  ): Promise<Transaction> {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(who.token))
      .send(body)
      .expect(201);
    return res.body as Transaction;
  }

  function putPointer(
    who: Person,
    ledgerId: string,
    personId: string,
    counterpartyId: string | null,
  ) {
    return request(server())
      .put(`/api/ledgers/${ledgerId}/people/${personId}/pointer`)
      .set(auth(who.token))
      .send({ counterpartyId });
  }

  function deletePointer(who: Person, ledgerId: string, personId: string) {
    return request(server())
      .delete(`/api/ledgers/${ledgerId}/people/${personId}/pointer`)
      .set(auth(who.token));
  }

  async function leave(who: Person, ledgerId: string): Promise<void> {
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: ledgerId, userId: who.userId } },
    });
  }

  /**
   * 退出前的帳：跟 Carol 有關的 3 筆（她在名單、她付、結清收款人是她），無關的 2 筆
   * （Alice 與 Bob 之間的支出、Bob 給 Alice 的結清）。
   */
  async function sceneWithHistory() {
    const s = await scene();
    const { Alice, Bob, Carol } = s.people;
    const withCarol = await postTransaction(
      s.alice,
      s.ledgerId,
      expense(s, s.alice, 150000, [Alice.id, Bob.id, Carol.id], '民宿'),
    );
    const carolPaid = await postTransaction(
      s.carol,
      s.ledgerId,
      expense(s, s.carol, 30000, [Alice.id, Bob.id], '早餐'),
    );
    const othersOnly = await postTransaction(
      s.bob,
      s.ledgerId,
      expense(s, s.bob, 60000, [Alice.id, Bob.id], '租車'),
    );
    const bobToCarol = await postSettlement(s.bob, s.ledgerId, {
      fromPersonId: Bob.id,
      toPersonId: Carol.id,
      amount: 10000,
      date: DAY,
      fromAccountId: s.bob.cashId,
    });
    const bobToAlice = await postSettlement(s.bob, s.ledgerId, {
      fromPersonId: Bob.id,
      toPersonId: Alice.id,
      amount: 20000,
      date: DAY,
      fromAccountId: s.bob.cashId,
    });
    return {
      s,
      related: [withCarol.id, carolPaid.id, bobToCarol.id],
      unrelated: [othersOnly.id, bobToAlice.id],
    };
  }

  async function listTransactionsAs(
    who: Person,
    ledgerId: string,
    query: Record<string, string | number> = {},
  ): Promise<Paginated<Transaction>> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .query({ limit: 100, ...query })
      .set(auth(who.token))
      .expect(200);
    return res.body as Paginated<Transaction>;
  }

  describe('SC-K3：退出後無法存取', () => {
    it('交易列表回 404', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions`)
        .query({ payerPersonId: s.people.Bob.id, limit: 1, page: 2 })
        .set(auth(s.carol.token))
        .expect(404);
    });

    it('篩選與分頁不能放寬範圍', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions`)
        .query({ payerPersonId: s.people.Bob.id, limit: 1, page: 2 })
        .set(auth(s.carol.token))
        .expect(404);
    });

    it('帳本明細退出後 404，其他成員仍能讀', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}`)
        .set(auth(s.carol.token))
        .expect(404);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}`)
        .set(auth(s.alice.token))
        .expect(200);
    });

    it('其他帳本端點與所有寫入都是 404，什麼都沒寫', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      const before = await prisma.transaction.count();

      const reads = [
        `/api/ledgers/${s.ledgerId}/people`,
        `/api/ledgers/${s.ledgerId}/settlement-summary`,
        `/api/ledgers/${s.ledgerId}/categories`,
        `/api/ledgers/${s.ledgerId}/members`,
      ];
      for (const path of reads) {
        await request(server()).get(path).set(auth(s.carol.token)).expect(404);
      }

      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/transactions`)
        .set(auth(s.carol.token))
        .send(expense(s, s.carol, 10000, [s.people.Alice.id, s.people.Carol.id], '偷記'))
        .expect(404);
      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/settlements`)
        .set(auth(s.carol.token))
        .send({
          fromPersonId: s.people.Carol.id,
          toPersonId: s.people.Alice.id,
          amount: 100,
          date: DAY,
          fromAccountId: s.carol.cashId,
        })
        .expect(404);
      await request(server())
        .patch(`/api/ledgers/${s.ledgerId}`)
        .set(auth(s.carol.token))
        .send({ name: '改名' })
        .expect(404);
      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/people`)
        .set(auth(s.carol.token))
        .send({ name: '阿美' })
        .expect(404);

      expect(await prisma.transaction.count()).toBe(before);
    });

    it('設定或清掉指向回 404', async () => {
      const { s } = await sceneWithHistory();
      const landlord = await createCounterparty(app, s.carol, '房東');
      await leave(s.carol, s.ledgerId);

      const put = await putPointer(s.carol, s.ledgerId, s.people.Bob.id, landlord.id).expect(404);
      expect((put.body as ApiErrorResponse).errorCode).toBe('NOT_FOUND');
      const del = await deletePointer(s.carol, s.ledgerId, s.people.Bob.id).expect(404);
      expect((del.body as ApiErrorResponse).errorCode).toBe('NOT_FOUND');
    });

    it('從沒加入過的人仍然全部 404', async () => {
      const { s } = await sceneWithHistory();
      const mine = await createCounterparty(app, s.eve, '阿B');

      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions`)
        .set(auth(s.eve.token))
        .expect(404);
      await request(server()).get(`/api/ledgers/${s.ledgerId}`).set(auth(s.eve.token)).expect(404);
      await putPointer(s.eve, s.ledgerId, s.people.Bob.id, mine.id).expect(404);
      await deletePointer(s.eve, s.ledgerId, s.people.Bob.id).expect(404);
    });

    it('退出後重新加入，可以照常讀寫', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      await addMember(s.alice, s.ledgerId, s.carol.email, 'EDITOR');

      await request(server())
        .get(`/api/ledgers/${s.ledgerId}`)
        .set(auth(s.carol.token))
        .expect(200);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/people`)
        .set(auth(s.carol.token))
        .expect(200);
      const page = await listTransactionsAs(s.carol, s.ledgerId);
      expect(page.total).toBe(5);
    });
  });

  describe('SC-F10：指向只有本人讀寫', () => {
    async function groupsOf(who: Person): Promise<LedgerGroup[]> {
      const res = await request(server())
        .get('/api/ledger-groups')
        .set(auth(who.token))
        .expect(200);
      return res.body as LedgerGroup[];
    }

    async function counterpartiesOf(who: Person): Promise<Counterparty[]> {
      const res = await request(server())
        .get('/api/counterparties')
        .query({ limit: 100 })
        .set(auth(who.token))
        .expect(200);
      return (res.body as Paginated<Counterparty>).items;
    }

    it('別人讀不到我的指向', async () => {
      const s = await scene();
      const landlord = await createCounterparty(app, s.alice, '房東');
      await putPointer(s.alice, s.ledgerId, s.people.Carol.id, landlord.id).expect(200);

      const bobGroups = await groupsOf(s.bob);
      const bobRaw = JSON.stringify(bobGroups) + JSON.stringify(await counterpartiesOf(s.bob));
      expect(bobRaw).not.toContain(landlord.id);
      const carolRow = bobGroups
        .find((g) => g.ledger.id === s.ledgerId)!
        .people.find((p) => p.person.id === s.people.Carol.id)!;
      expect(carolRow.pointer).toEqual({ counterpartyId: null, auto: true });

      const aliceRow = (await groupsOf(s.alice))
        .find((g) => g.ledger.id === s.ledgerId)!
        .people.find((p) => p.person.id === s.people.Carol.id)!;
      expect(aliceRow.pointer).toEqual({ counterpartyId: landlord.id, auto: false });
    });

    it('自動指向只看自己的連動對象', async () => {
      const s = await scene();
      const { aCounterpartyId } = await linkPair(app, s.alice, s.bob, '明哥', '阿A');

      const aliceBob = (await groupsOf(s.alice))
        .find((g) => g.ledger.id === s.ledgerId)!
        .people.find((p) => p.person.id === s.people.Bob.id)!;
      expect(aliceBob.pointer).toEqual({ counterpartyId: aCounterpartyId, auto: true });

      const carolBob = (await groupsOf(s.carol))
        .find((g) => g.ledger.id === s.ledgerId)!
        .people.find((p) => p.person.id === s.people.Bob.id)!;
      expect(carolBob.pointer).toEqual({ counterpartyId: null, auto: true });
    });

    it('帶別人的對象回 404，什麼都沒寫', async () => {
      const s = await scene();
      const bobs = await createCounterparty(app, s.bob, 'Bob 的房東');

      await putPointer(s.alice, s.ledgerId, s.people.Carol.id, bobs.id).expect(404);
      expect(
        await prisma.$queryRawUnsafe<unknown[]>('SELECT 1 FROM "LedgerPersonPointer"'),
      ).toEqual([]);
    });

    it('我沒參與過的帳本、別本帳本的人都回 404', async () => {
      const s = await scene();
      const landlord = await createCounterparty(app, s.alice, '房東');

      await putPointer(s.alice, s.eveLedgerId, s.evePerson.id, landlord.id).expect(404);
      await deletePointer(s.alice, s.eveLedgerId, s.evePerson.id).expect(404);
      await putPointer(s.alice, s.ledgerId, s.evePerson.id, landlord.id).expect(404);
      await deletePointer(s.alice, s.ledgerId, s.evePerson.id).expect(404);
    });

    it('不能指向自己那一筆（400）', async () => {
      const s = await scene();
      const landlord = await createCounterparty(app, s.alice, '房東');
      await putPointer(s.alice, s.ledgerId, s.people.Alice.id, landlord.id).expect(400);
    });

    it('我的設定不影響別人的指向', async () => {
      const s = await scene();
      const aliceLandlord = await createCounterparty(app, s.alice, '房東');
      const bobFriend = await createCounterparty(app, s.bob, '小華');
      await putPointer(s.alice, s.ledgerId, s.people.Carol.id, aliceLandlord.id).expect(200);
      await putPointer(s.bob, s.ledgerId, s.people.Carol.id, bobFriend.id).expect(200);
      await deletePointer(s.alice, s.ledgerId, s.people.Carol.id).expect(200);

      const bobCarol = (await groupsOf(s.bob))
        .find((g) => g.ledger.id === s.ledgerId)!
        .people.find((p) => p.person.id === s.people.Carol.id)!;
      expect(bobCarol.pointer).toEqual({ counterpartyId: bobFriend.id, auto: false });
    });

    it('退出後讀不到別人之間的交易（同 SC-F9，從另一個人的角度）', async () => {
      const { s } = await sceneWithHistory();
      await leave(s.carol, s.ledgerId);
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions`)
        .query({ payerPersonId: s.people.Bob.id, limit: 1, page: 2 })
        .set(auth(s.carol.token))
        .expect(404);
    });
  });
});
