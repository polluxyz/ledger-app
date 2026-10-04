import { INestApplication } from '@nestjs/common';
import type {
  Account,
  ApiErrorResponse,
  CreateSettlementRequest,
  CreateTransactionRequest,
  LedgerPerson,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 共享帳本分帳與結清的授權與資料隔離（spec 3e §3.5、§5.5，SC-E17、SC-E18）。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - SC-E17：沒加入帳本的人什麼都碰不到（404，不透露存在）；別本帳本的 `LedgerPerson` id 一律 404；
 *   VIEWER 只能讀，唯一的例外是「付款人本人補自己的帳戶」，而且只能走補帳戶端點；
 *   帳戶只能由主人選；封存帳本拒絕寫入。任何一種失敗都**不能留下任何資料**。
 * - SC-E18：成員之間看得到彼此付的交易與結清，但看不到對方的帳戶；帳本分帳與結清不進任何人的
 *   個人往來帳。
 *
 * 場景：Alice（OWNER）建共享帳本「花蓮三日」，Bob 是 EDITOR、Vic 是 VIEWER；Eve 不在帳本裡，
 * 有一本自己的共享帳本。計數用 raw SQL，不依賴 Prisma Client 的 model 名稱。
 */
describe('Ledger split isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const DAY = '2026-10-04T12:00:00.000Z';

  interface Scene {
    alice: Person;
    bob: Person;
    vic: Person;
    eve: Person;
    /** 花蓮三日。 */
    ledgerId: string;
    /** Eve 自己的共享帳本。 */
    eveLedgerId: string;
    /** 花蓮三日裡的人，依名字找。 */
    people: Record<'Alice' | 'Bob' | 'Vic', LedgerPerson>;
    /** Eve 帳本裡 Eve 自己那一筆。 */
    evePerson: LedgerPerson;
    expenseCategoryId: string;
  }

  async function countRows(table: string, where = 'TRUE'): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
    );
    return Number(rows[0]!.n);
  }

  /**
   * 失敗的請求不能留下任何東西（SC-E17 最後一句）。`transactionsBefore` 是失敗前已存在的交易數，
   * 結清與名單在失敗前都假設是 0 筆（各測試的前置不建結清與名單時才用這個）。
   */
  async function expectNothingWritten(transactionsBefore = 0): Promise<void> {
    expect(await countRows('Transaction')).toBe(transactionsBefore);
    expect(await countRows('LedgerSplit')).toBe(0);
    expect(await countRows('LedgerShare')).toBe(0);
    expect(await countRows('LedgerSettlement')).toBe(0);
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
    const vic = await person(app, 'vic@example.com', 'Vic');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const ledgerId = await createSharedLedger(app, alice.token, '花蓮三日');
    await addMember(alice, ledgerId, bob.email, 'EDITOR');
    await addMember(alice, ledgerId, vic.email, 'VIEWER');
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
      vic,
      eve,
      ledgerId,
      eveLedgerId,
      people: { Alice: byName('Alice'), Bob: byName('Bob'), Vic: byName('Vic') },
      evePerson: evePerson!,
      expenseCategoryId: await firstCategoryId(alice, ledgerId),
    };
  }

  /** 晚餐 1,500 元，三人均分；`overrides` 決定付款人與帳戶。 */
  function dinner(
    s: Scene,
    overrides: Partial<CreateTransactionRequest> = {},
    extraPersonIds: string[] = [],
  ): CreateTransactionRequest {
    const people = [s.people.Alice.id, s.people.Bob.id, s.people.Vic.id, ...extraPersonIds];
    return {
      type: 'EXPENSE',
      amount: 150000,
      date: DAY,
      categoryId: s.expenseCategoryId,
      title: '晚餐',
      ledgerSplit: { method: 'EQUAL', shares: people.map((personId) => ({ personId })) },
      ...overrides,
    };
  }

  function postTransaction(who: Person, ledgerId: string, body: CreateTransactionRequest) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .send(body);
  }

  function postSettlement(who: Person, ledgerId: string, body: CreateSettlementRequest) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(who.token))
      .send(body);
  }

  function putTransactionAccount(who: Person, ledgerId: string, id: string, accountId: string) {
    return request(server())
      .put(`/api/ledgers/${ledgerId}/transactions/${id}/account`)
      .set(auth(who.token))
      .send({ accountId });
  }

  function putSettlementAccount(who: Person, ledgerId: string, id: string, accountId: string) {
    return request(server())
      .put(`/api/ledgers/${ledgerId}/settlements/${id}/account`)
      .set(auth(who.token))
      .send({ accountId });
  }

  async function balanceOf(who: Person, accountId: string): Promise<number> {
    const accounts: Account[] = await listAccounts(app, who.token);
    return accounts.find((account) => account.id === accountId)!.balance;
  }

  async function listTransactions(who: Person, ledgerId: string): Promise<Transaction[]> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<Transaction>).items;
  }

  describe('SC-E17：沒加入帳本的人一律 404', () => {
    it('讀寫 people、summary、結清、帶名單的交易、補帳戶都是 404，什麼都沒寫', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { accountId: s.alice.cashId }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);
      const settlement = await postSettlement(s.alice, s.ledgerId, {
        fromPersonId: s.people.Bob.id,
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        toAccountId: s.alice.cashId,
      })
        .expect(201)
        .then((res) => res.body as Transaction);
      const before = await countRows('Transaction');
      const sharesBefore = await countRows('LedgerShare');
      const base = `/api/ledgers/${s.ledgerId}`;
      const eve = auth(s.eve.token);

      await request(server()).get(`${base}/people`).set(eve).expect(404);
      await request(server()).post(`${base}/people`).set(eve).send({ name: '阿美' }).expect(404);
      await request(server())
        .patch(`${base}/people/${s.people.Bob.id}`)
        .set(eve)
        .send({ name: 'x' })
        .expect(404);
      await request(server()).delete(`${base}/people/${s.people.Bob.id}`).set(eve).expect(404);
      await request(server()).get(`${base}/settlement-summary`).set(eve).expect(404);
      await request(server()).get(`${base}/transactions/${tx.id}`).set(eve).expect(404);
      await postSettlement(s.eve, s.ledgerId, {
        toPersonId: s.people.Alice.id,
        amount: 100,
        date: DAY,
      }).expect(404);
      await request(server())
        .patch(`${base}/settlements/${settlement.id}`)
        .set(eve)
        .send({ amount: 1 })
        .expect(404);
      await request(server()).delete(`${base}/settlements/${settlement.id}`).set(eve).expect(404);
      await putTransactionAccount(s.eve, s.ledgerId, tx.id, s.eve.cashId).expect(404);
      await putSettlementAccount(s.eve, s.ledgerId, settlement.id, s.eve.cashId).expect(404);

      expect(await countRows('Transaction')).toBe(before);
      expect(await countRows('LedgerShare')).toBe(sharesBefore);
      expect(await countRows('LedgerSettlement')).toBe(1);
      expect(await countRows('LedgerPerson', `"name" = '阿美'`)).toBe(0);
    });

    it('個人帳本沒有 people 端點（404）', async () => {
      const s = await scene();
      await request(server())
        .get(`/api/ledgers/${s.alice.ledgerId}/people`)
        .set(auth(s.alice.token))
        .expect(404);
    });
  });

  describe('SC-E17：別本帳本的 LedgerPerson id 一律 404', () => {
    it('付款人是別本帳本的人 → 404，什麼都沒寫', async () => {
      const s = await scene();
      await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.evePerson.id }),
      ).expect(404);
      await expectNothingWritten();
    });

    it('名單有別本帳本的人 → 404，什麼都沒寫', async () => {
      const s = await scene();
      const body = dinner(s, { accountId: s.alice.cashId }, [s.evePerson.id]);
      await postTransaction(s.alice, s.ledgerId, body).expect(404);
      await expectNothingWritten();
    });

    it('結清的任一方是別本帳本的人 → 404，什麼都沒寫', async () => {
      const s = await scene();
      await postSettlement(s.alice, s.ledgerId, {
        toPersonId: s.evePerson.id,
        amount: 100,
        date: DAY,
        fromAccountId: s.alice.cashId,
      }).expect(404);
      await postSettlement(s.alice, s.ledgerId, {
        fromPersonId: s.evePerson.id,
        toPersonId: s.people.Alice.id,
        amount: 100,
        date: DAY,
        toAccountId: s.alice.cashId,
      }).expect(404);
      await expectNothingWritten();
    });

    it('從自己的帳本路徑改、刪別本帳本的人 → 404，Eve 那筆不變', async () => {
      const s = await scene();
      const guest = await request(server())
        .post(`/api/ledgers/${s.eveLedgerId}/people`)
        .set(auth(s.eve.token))
        .send({ name: '阿夏' })
        .expect(201)
        .then((res) => res.body as LedgerPerson);
      const base = `/api/ledgers/${s.ledgerId}/people/${guest.id}`;

      await request(server()).patch(base).set(auth(s.alice.token)).send({ name: 'x' }).expect(404);
      await request(server()).delete(base).set(auth(s.alice.token)).expect(404);

      const eves = await listPeople(s.eve, s.eveLedgerId);
      expect(eves.find((p) => p.id === guest.id)?.name).toBe('阿夏');
    });
  });

  describe('SC-E17：VIEWER 只能讀', () => {
    it('記交易、記結清、加非成員都是 403，什麼都沒寫', async () => {
      const s = await scene();
      await postTransaction(s.vic, s.ledgerId, dinner(s, { accountId: s.vic.cashId })).expect(403);
      await postSettlement(s.vic, s.ledgerId, {
        toPersonId: s.people.Alice.id,
        amount: 100,
        date: DAY,
        fromAccountId: s.vic.cashId,
      }).expect(403);
      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/people`)
        .set(auth(s.vic.token))
        .send({ name: '阿美' })
        .expect(403);

      await expectNothingWritten();
      expect(await countRows('LedgerPerson', `"userId" IS NULL`)).toBe(0);
    });

    it('改名單、改刪結清、改刪非成員都是 403，資料不變', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { accountId: s.alice.cashId }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);
      const settlement = await postSettlement(s.alice, s.ledgerId, {
        fromPersonId: s.people.Bob.id,
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        toAccountId: s.alice.cashId,
      })
        .expect(201)
        .then((res) => res.body as Transaction);
      const guest = await request(server())
        .post(`/api/ledgers/${s.ledgerId}/people`)
        .set(auth(s.alice.token))
        .send({ name: '阿美' })
        .expect(201)
        .then((res) => res.body as LedgerPerson);
      const base = `/api/ledgers/${s.ledgerId}`;
      const vic = auth(s.vic.token);

      await request(server())
        .patch(`${base}/transactions/${tx.id}`)
        .set(vic)
        .send({ ledgerSplit: null })
        .expect(403);
      await request(server())
        .patch(`${base}/settlements/${settlement.id}`)
        .set(vic)
        .send({ amount: 1 })
        .expect(403);
      await request(server()).delete(`${base}/settlements/${settlement.id}`).set(vic).expect(403);
      await request(server())
        .patch(`${base}/people/${guest.id}`)
        .set(vic)
        .send({ name: 'x' })
        .expect(403);
      await request(server()).delete(`${base}/people/${guest.id}`).set(vic).expect(403);

      expect(await countRows('LedgerShare')).toBe(3);
      expect(await countRows('LedgerSettlement')).toBe(1);
      expect(await countRows('Transaction', `"deletedAt" IS NULL`)).toBe(2);
      expect(await countRows('LedgerPerson', `"name" = '阿美' AND "deletedAt" IS NULL`)).toBe(1);
    });

    it('VIEWER 是付款人時能用補帳戶端點補自己的帳戶，但不能用 PATCH 改金額', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Vic.id }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);
      expect(tx.account).toBeNull();
      const vicBefore = await balanceOf(s.vic, s.vic.cashId);

      const filled = await putTransactionAccount(s.vic, s.ledgerId, tx.id, s.vic.cashId)
        .expect(200)
        .then((res) => res.body as Transaction);
      expect(filled.accountPending).toBe(false);
      expect(filled.account?.id).toBe(s.vic.cashId);
      expect(await balanceOf(s.vic, s.vic.cashId)).toBe(vicBefore - 150000);

      await request(server())
        .patch(`/api/ledgers/${s.ledgerId}/transactions/${tx.id}`)
        .set(auth(s.vic.token))
        .send({ amount: 1 })
        .expect(403);
      const after = await prisma.$queryRawUnsafe<Array<{ amount: number }>>(
        `SELECT amount FROM "Transaction" WHERE id = $1`,
        tx.id,
      );
      expect(after[0]!.amount).toBe(150000);
    });
  });

  describe('SC-E17：帳戶只能由主人選', () => {
    it('付款人是別人時帶自己的帳戶 → 400 ACCOUNT_NOT_PAYERS，什麼都沒寫', async () => {
      const s = await scene();
      const res = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Bob.id, accountId: s.alice.cashId }),
      ).expect(400);
      expect((res.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_PAYERS');
      await expectNothingWritten();
    });

    it('結清時替對方帶帳戶 → 400 ACCOUNT_NOT_PAYERS，什麼都沒寫', async () => {
      const s = await scene();
      const res = await postSettlement(s.alice, s.ledgerId, {
        fromPersonId: s.people.Bob.id,
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        fromAccountId: s.alice.cashId,
        toAccountId: s.alice.cashId,
      }).expect(400);
      expect((res.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_PAYERS');
      await expectNothingWritten();
    });

    it('不是付款人的人打補帳戶端點 → 400 ACCOUNT_NOT_PAYERS，帳戶仍空著', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Vic.id }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);

      const res = await putTransactionAccount(s.bob, s.ledgerId, tx.id, s.bob.cashId).expect(400);
      expect((res.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_PAYERS');
      const rows = await prisma.$queryRawUnsafe<Array<{ accountId: string | null }>>(
        `SELECT "accountId" FROM "Transaction" WHERE id = $1`,
        tx.id,
      );
      expect(rows[0]!.accountId).toBeNull();
    });

    it('付款人補帳戶時用別人的帳戶 → 404，帳戶仍空著', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Bob.id }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);

      await putTransactionAccount(s.bob, s.ledgerId, tx.id, s.alice.cashId).expect(404);
      const rows = await prisma.$queryRawUnsafe<Array<{ accountId: string | null }>>(
        `SELECT "accountId" FROM "Transaction" WHERE id = $1`,
        tx.id,
      );
      expect(rows[0]!.accountId).toBeNull();
    });

    it('結清：不相關的人補帳戶 → 400；收錢的人補的是收款那一邊', async () => {
      const s = await scene();
      const settlement = await postSettlement(s.bob, s.ledgerId, {
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        fromAccountId: s.bob.cashId,
      })
        .expect(201)
        .then((res) => res.body as Transaction);

      // Vic 既不付也不收。
      const res = await putSettlementAccount(s.vic, s.ledgerId, settlement.id, s.vic.cashId).expect(
        400,
      );
      expect((res.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_NOT_PAYERS');

      const aliceBefore = await balanceOf(s.alice, s.alice.cashId);
      await putSettlementAccount(s.alice, s.ledgerId, settlement.id, s.alice.cashId).expect(200);
      expect(await balanceOf(s.alice, s.alice.cashId)).toBe(aliceBefore + 50000);

      const rows = await prisma.$queryRawUnsafe<
        Array<{ accountId: string | null; toAccountId: string | null }>
      >(`SELECT "accountId", "toAccountId" FROM "Transaction" WHERE id = $1`, settlement.id);
      expect(rows[0]).toEqual({ accountId: s.bob.cashId, toAccountId: s.alice.cashId });
    });
  });

  describe('SC-E17：封存帳本拒絕寫入', () => {
    it('加非成員、記交易、記結清、補帳戶都是 409；summary 照樣能讀', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Bob.id }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);
      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/archive`)
        .set(auth(s.alice.token))
        .expect(201);
      const before = await countRows('Transaction');

      await request(server())
        .post(`/api/ledgers/${s.ledgerId}/people`)
        .set(auth(s.alice.token))
        .send({ name: '阿美' })
        .expect(409);
      await postTransaction(s.alice, s.ledgerId, dinner(s, { accountId: s.alice.cashId })).expect(
        409,
      );
      await postSettlement(s.alice, s.ledgerId, {
        fromPersonId: s.people.Bob.id,
        toPersonId: s.people.Alice.id,
        amount: 100,
        date: DAY,
        toAccountId: s.alice.cashId,
      }).expect(409);
      await putTransactionAccount(s.bob, s.ledgerId, tx.id, s.bob.cashId).expect(409);

      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/settlement-summary`)
        .set(auth(s.vic.token))
        .expect(200);
      expect(await countRows('Transaction')).toBe(before);
      expect(await countRows('LedgerSettlement')).toBe(0);
      expect(await countRows('LedgerPerson', `"userId" IS NULL`)).toBe(0);
    });
  });

  describe('SC-E18：看得到別人付的，看不到別人的帳戶', () => {
    it('成員讀別人付的交易與結清時，account、toAccount 是 null', async () => {
      const s = await scene();
      await postTransaction(s.alice, s.ledgerId, dinner(s, { accountId: s.alice.cashId })).expect(
        201,
      );
      const settlement = await postSettlement(s.bob, s.ledgerId, {
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        fromAccountId: s.bob.cashId,
      })
        .expect(201)
        .then((res) => res.body as Transaction);
      await putSettlementAccount(s.alice, s.ledgerId, settlement.id, s.alice.cashId).expect(200);

      const asVic = await listTransactions(s.vic, s.ledgerId);
      expect(asVic).toHaveLength(2);
      for (const row of asVic) {
        expect(row.account).toBeNull();
        expect(row.toAccount).toBeNull();
      }
      const dinnerAsVic = asVic.find((row) => row.type === 'EXPENSE')!;
      expect(dinnerAsVic.payer?.id).toBe(s.people.Alice.id);
      expect(dinnerAsVic.ledgerSplit?.shares).toHaveLength(3);

      const asBob = await listTransactions(s.bob, s.ledgerId);
      const settlementAsBob = asBob.find((row) => row.id === settlement.id)!;
      expect(settlementAsBob.account?.id).toBe(s.bob.cashId);
      expect(settlementAsBob.toAccount).toBeNull();
      expect(settlementAsBob.settlement?.from.id).toBe(s.people.Bob.id);

      const asAlice = await listTransactions(s.alice, s.ledgerId);
      const settlementAsAlice = asAlice.find((row) => row.id === settlement.id)!;
      expect(settlementAsAlice.account).toBeNull();
      expect(settlementAsAlice.toAccount?.id).toBe(s.alice.cashId);
    });

    it('accountPending 只對要補的那個人是 true', async () => {
      const s = await scene();
      const tx = await postTransaction(
        s.alice,
        s.ledgerId,
        dinner(s, { payerPersonId: s.people.Bob.id }),
      )
        .expect(201)
        .then((res) => res.body as Transaction);
      expect(tx.accountPending).toBe(false);

      const pendingFor = async (who: Person) =>
        (await listTransactions(who, s.ledgerId)).find((row) => row.id === tx.id)!.accountPending;
      expect(await pendingFor(s.bob)).toBe(true);
      expect(await pendingFor(s.alice)).toBe(false);
      expect(await pendingFor(s.vic)).toBe(false);
    });

    it('帳本分帳與結清不進任何人的往來帳', async () => {
      const s = await scene();
      await postTransaction(s.alice, s.ledgerId, dinner(s, { accountId: s.alice.cashId })).expect(
        201,
      );
      await postSettlement(s.bob, s.ledgerId, {
        toPersonId: s.people.Alice.id,
        amount: 50000,
        date: DAY,
        fromAccountId: s.bob.cashId,
      }).expect(201);

      expect(await countRows('Counterparty')).toBe(0);
      expect(await countRows('DebtEntry')).toBe(0);
      expect(await countRows('DebtProposal')).toBe(0);
      expect(await countRows('Split')).toBe(0);
      for (const who of [s.alice, s.bob, s.vic]) {
        const res = await request(server())
          .get('/api/counterparties')
          .set(auth(who.token))
          .expect(200);
        expect((res.body as Paginated<unknown>).items).toEqual([]);
        for (const row of await listTransactions(who, s.ledgerId)) {
          expect(row.debt).toBeNull();
          expect(row.split).toBeNull();
        }
      }
    });
  });
});
