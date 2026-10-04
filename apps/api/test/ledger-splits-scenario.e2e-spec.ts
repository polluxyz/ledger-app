import { INestApplication } from '@nestjs/common';
import type {
  Account,
  ApiErrorResponse,
  CreateSplitRequest,
  LedgerPerson,
  Paginated,
  SettlementSummary,
  Split,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, createCounterparty, person, type Person } from './linking-utils';

/**
 * 把帳本裡的人、交易、結清與 3c 分帳串成同一條「花蓮三日」情境，所有業務資料都經 HTTP 建立或更新。
 */
/** 跨模組情境驗證付款人、份額、結清建議與帳戶餘額在連續操作後仍一致。 */
describe('Ledger split cross-module scenario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const DAY = '2026-10-04T12:00:00.000Z';
  const server = () => httpServer(app);

  interface Scene {
    me: Person;
    ming: Person;
    hua: Person;
    ledgerId: string;
    categoryId: string;
    people: { me: LedgerPerson; ming: LedgerPerson; hua: LedgerPerson };
  }

  type ExpectedPersonNet = [name: string, status: string, net: number];
  type ExpectedSuggestion = {
    fromPersonId: string;
    toPersonId: string;
    amount: number;
  };

  async function scene(): Promise<Scene> {
    const me = await person(app, 'me@example.com', '我');
    const ming = await person(app, 'ming@example.com', '小明');
    const hua = await person(app, 'hua@example.com', '小華');
    const ledgerId = await createSharedLedger(app, me.token, '花蓮三日');

    for (const member of [ming, hua]) {
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(me.token))
        .send({ email: member.email, role: 'EDITOR' })
        .expect(201);
    }

    const peopleResponse = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(me.token))
      .expect(200);
    const ledgerPeople = peopleResponse.body as LedgerPerson[];
    const mePerson = ledgerPeople.find((ledgerPerson) => ledgerPerson.userId === me.userId);
    const mingPerson = ledgerPeople.find((ledgerPerson) => ledgerPerson.userId === ming.userId);
    const huaPerson = ledgerPeople.find((ledgerPerson) => ledgerPerson.userId === hua.userId);
    if (!mePerson || !mingPerson || !huaPerson) {
      throw new Error('Expected each ledger member to have a LedgerPerson.');
    }

    const categoriesResponse = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(me.token))
      .expect(200);

    return {
      me,
      ming,
      hua,
      ledgerId,
      categoryId: (categoriesResponse.body as Array<{ id: string }>)[0]!.id,
      people: { me: mePerson, ming: mingPerson, hua: huaPerson },
    };
  }

  function equalSplit(personIds: string[]) {
    return {
      method: 'EQUAL',
      shares: personIds.map((personId) => ({ personId })),
    };
  }

  function createTransaction(s: Scene, actor: Person, body: Record<string, unknown>) {
    return request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(actor.token))
      .send({ date: DAY, categoryId: s.categoryId, ...body });
  }

  function patchTransaction(
    s: Scene,
    actor: Person,
    transactionId: string,
    body: Record<string, unknown>,
  ) {
    return request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${transactionId}`)
      .set(auth(actor.token))
      .send(body);
  }

  function createSettlement(s: Scene, actor: Person, body: Record<string, unknown>) {
    return request(server())
      .post(`/api/ledgers/${s.ledgerId}/settlements`)
      .set(auth(actor.token))
      .send({ date: DAY, ...body });
  }

  async function transactionDetail(
    s: Scene,
    who: Person,
    transactionId: string,
  ): Promise<Transaction> {
    const response = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions/${transactionId}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Transaction;
  }

  async function transactionList(
    s: Scene,
    who: Person,
    query: Record<string, string | number> = { limit: 100 },
  ): Promise<Paginated<Transaction>> {
    const response = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions`)
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return response.body as Paginated<Transaction>;
  }

  async function summary(s: Scene, who: Person = s.me): Promise<SettlementSummary> {
    const response = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/settlement-summary`)
      .set(auth(who.token))
      .expect(200);
    return response.body as SettlementSummary;
  }

  function namedNets(result: SettlementSummary): ExpectedPersonNet[] {
    return result.people.map(({ person: ledgerPerson, net }) => [
      ledgerPerson.name,
      ledgerPerson.status,
      net,
    ]);
  }

  async function accountBalance(who: Person, accountId: string): Promise<number> {
    const accounts: Account[] = await listAccounts(app, who.token);
    const account = accounts.find((row) => row.id === accountId);
    if (!account) throw new Error('Expected the account in its owner account list.');
    return account.balance;
  }

  /** 每個寫入步驟都重讀 summary 與三位成員的帳戶，避免只驗成功回應而漏掉跨模組偏差。 */
  async function expectState(
    s: Scene,
    expectedPeople: ExpectedPersonNet[],
    expectedSuggestions: ExpectedSuggestion[],
    balances: { me: number; ming: number; hua: number },
  ): Promise<void> {
    const current = await summary(s);
    expect(namedNets(current)).toEqual(expectedPeople);
    expect(current.suggestions).toEqual(expectedSuggestions);
    const [meBalance, mingBalance, huaBalance] = await Promise.all([
      accountBalance(s.me, s.me.cashId),
      accountBalance(s.ming, s.ming.cashId),
      accountBalance(s.hua, s.hua.cashId),
    ]);
    expect({ me: meBalance, ming: mingBalance, hua: huaBalance }).toEqual(balances);
  }

  it('SC-E2–E19: follows the Hualien trip through split, settlement, guest, departure, and 3c regression', async () => {
    const s = await scene();
    const memberIds = [s.people.me.id, s.people.ming.id, s.people.hua.id];

    // 住宿：我付款，三人均分。
    const lodgingResponse = await createTransaction(s, s.me, {
      type: 'EXPENSE',
      amount: 600000,
      accountId: s.me.cashId,
      note: '住宿',
      ledgerSplit: equalSplit(memberIds),
    }).expect(201);
    const lodging = lodgingResponse.body as Transaction;
    expect(lodging).toMatchObject({
      type: 'EXPENSE',
      amount: 600000,
      payer: { id: s.people.me.id, name: '我', status: 'MEMBER' },
      account: { id: s.me.cashId },
      accountPending: false,
    });
    expect(
      lodging.ledgerSplit?.shares.map(({ person: member, share }) => [member.id, share]),
    ).toEqual([
      [s.people.me.id, 200000],
      [s.people.ming.id, 200000],
      [s.people.hua.id, 200000],
    ]);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 400000],
        ['小明', 'MEMBER', -200000],
        ['小華', 'MEMBER', -200000],
      ],
      [
        { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 200000 },
        { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 200000 },
      ],
      { me: -600000, ming: 0, hua: 0 },
    );

    // 晚餐由我代記、小明付款；他補帳戶前只有他本人會看到待補提示。
    const dinnerResponse = await createTransaction(s, s.me, {
      type: 'EXPENSE',
      amount: 150000,
      payerPersonId: s.people.ming.id,
      note: '晚餐',
      ledgerSplit: equalSplit(memberIds),
    }).expect(201);
    const dinner = dinnerResponse.body as Transaction;
    expect(dinner).toMatchObject({
      type: 'EXPENSE',
      amount: 150000,
      payer: { id: s.people.ming.id, name: '小明' },
      account: null,
      accountPending: false,
    });
    expect(dinner.ledgerSplit?.shares.map(({ share }) => share)).toEqual([50000, 50000, 50000]);
    const [meDinner, mingDinner, huaDinner] = await Promise.all([
      transactionDetail(s, s.me, dinner.id),
      transactionDetail(s, s.ming, dinner.id),
      transactionDetail(s, s.hua, dinner.id),
    ]);
    expect(meDinner.accountPending).toBe(false);
    expect(mingDinner.accountPending).toBe(true);
    expect(huaDinner.accountPending).toBe(false);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 350000],
        ['小明', 'MEMBER', -100000],
        ['小華', 'MEMBER', -250000],
      ],
      [
        { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 250000 },
        { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 },
      ],
      { me: -600000, ming: 0, hua: 0 },
    );

    const dinnerAccountResponse = await request(server())
      .put(`/api/ledgers/${s.ledgerId}/transactions/${dinner.id}/account`)
      .set(auth(s.ming.token))
      .send({ accountId: s.ming.cashId })
      .expect(200);
    const dinnerWithMingAccount = dinnerAccountResponse.body as Transaction;
    expect(dinnerWithMingAccount).toMatchObject({
      id: dinner.id,
      account: { id: s.ming.cashId },
      accountPending: false,
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', 350000],
        ['小明', 'MEMBER', -100000],
        ['小華', 'MEMBER', -250000],
      ],
      [
        { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 250000 },
        { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 },
      ],
      { me: -600000, ming: -150000, hua: 0 },
    );

    // 油錢由小華記、小華付款，我和小華均分；此時得到規格中的 SC-E4 淨額。
    const fuelResponse = await createTransaction(s, s.hua, {
      type: 'EXPENSE',
      amount: 90000,
      accountId: s.hua.cashId,
      note: '油錢',
      ledgerSplit: equalSplit([s.people.me.id, s.people.hua.id]),
    }).expect(201);
    const fuel = fuelResponse.body as Transaction;
    expect(fuel).toMatchObject({
      type: 'EXPENSE',
      amount: 90000,
      payer: { id: s.people.hua.id, name: '小華' },
      account: { id: s.hua.cashId },
      accountPending: false,
    });
    expect(fuel.ledgerSplit?.shares.map(({ person: member, share }) => [member.id, share])).toEqual(
      [
        [s.people.me.id, 45000],
        [s.people.hua.id, 45000],
      ],
    );
    const e4People: ExpectedPersonNet[] = [
      ['我', 'MEMBER', 305000],
      ['小明', 'MEMBER', -100000],
      ['小華', 'MEMBER', -205000],
    ];
    const e4Suggestions: ExpectedSuggestion[] = [
      { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 205000 },
      { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 },
    ];
    await expectState(s, e4People, e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    // SC-E5：小華付清他的份額；收款人補入自己的帳戶後兩邊餘額都反映轉帳。
    const huaSettlementResponse = await createSettlement(s, s.hua, {
      toPersonId: s.people.me.id,
      amount: 205000,
      fromAccountId: s.hua.cashId,
    }).expect(201);
    const huaSettlement = huaSettlementResponse.body as Transaction;
    expect(huaSettlement).toMatchObject({
      type: 'TRANSFER',
      amount: 205000,
      account: { id: s.hua.cashId },
      toAccount: null,
      settlement: {
        from: { id: s.people.hua.id, name: '小華' },
        to: { id: s.people.me.id, name: '我' },
      },
    });
    const huaSettlementId = huaSettlement.settlement!.id;
    const settlementPendingForMe = await transactionDetail(s, s.me, huaSettlement.id);
    expect(settlementPendingForMe.accountPending).toBe(true);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 100000],
        ['小明', 'MEMBER', -100000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 }],
      { me: -600000, ming: -150000, hua: -295000 },
    );
    const huaSettlementAccountResponse = await request(server())
      .put(`/api/ledgers/${s.ledgerId}/settlements/${huaSettlementId}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(200);
    const huaSettlementWithRecipientAccount = huaSettlementAccountResponse.body as Transaction;
    expect(huaSettlementWithRecipientAccount).toMatchObject({
      id: huaSettlement.id,
      toAccount: { id: s.me.cashId },
      accountPending: false,
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', 100000],
        ['小明', 'MEMBER', -100000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 }],
      { me: -395000, ming: -150000, hua: -295000 },
    );

    // SC-E6：小明多付 20,000 分，建議方向因此反轉。
    const mingSettlementResponse = await createSettlement(s, s.ming, {
      toPersonId: s.people.me.id,
      amount: 120000,
      fromAccountId: s.ming.cashId,
    }).expect(201);
    const mingSettlement = mingSettlementResponse.body as Transaction;
    expect(mingSettlement).toMatchObject({
      type: 'TRANSFER',
      amount: 120000,
      settlement: {
        from: { id: s.people.ming.id, name: '小明' },
        to: { id: s.people.me.id, name: '我' },
      },
    });
    const mingSettlementId = mingSettlement.settlement!.id;
    expect((await transactionDetail(s, s.me, mingSettlement.id)).accountPending).toBe(true);
    await expectState(
      s,
      [
        ['我', 'MEMBER', -20000],
        ['小明', 'MEMBER', 20000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.me.id, toPersonId: s.people.ming.id, amount: 20000 }],
      { me: -395000, ming: -270000, hua: -295000 },
    );
    const mingSettlementAccountResponse = await request(server())
      .put(`/api/ledgers/${s.ledgerId}/settlements/${mingSettlementId}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(200);
    expect(mingSettlementAccountResponse.body as Transaction).toMatchObject({
      id: mingSettlement.id,
      toAccount: { id: s.me.cashId },
      accountPending: false,
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', -20000],
        ['小明', 'MEMBER', 20000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.me.id, toPersonId: s.people.ming.id, amount: 20000 }],
      { me: -275000, ming: -270000, hua: -295000 },
    );

    // SC-E13：結清雖然顯示為 TRANSFER，一般交易端點仍不能修改或刪除它。
    const readOnlyPatch = await patchTransaction(s, s.me, mingSettlement.id, {
      amount: 100000,
    }).expect(409);
    expect((readOnlyPatch.body as ApiErrorResponse).errorCode).toBe(
      'SETTLEMENT_TRANSACTION_READ_ONLY',
    );
    const readOnlyDelete = await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/transactions/${mingSettlement.id}`)
      .set(auth(s.me.token))
      .expect(409);
    expect((readOnlyDelete.body as ApiErrorResponse).errorCode).toBe(
      'SETTLEMENT_TRANSACTION_READ_ONLY',
    );
    await expectState(
      s,
      [
        ['我', 'MEMBER', -20000],
        ['小明', 'MEMBER', 20000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.me.id, toPersonId: s.people.ming.id, amount: 20000 }],
      { me: -275000, ming: -270000, hua: -295000 },
    );

    // 為讓 SC-E9 的起點維持在 SC-E4 淨額，透過結清端點撤回前兩筆已驗證的結清。
    const undoMingSettlement = await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/settlements/${mingSettlementId}`)
      .set(auth(s.me.token))
      .expect(204);
    expect(undoMingSettlement.status).toBe(204);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 100000],
        ['小明', 'MEMBER', -100000],
        ['小華', 'MEMBER', 0],
      ],
      [{ fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 100000 }],
      { me: -395000, ming: -150000, hua: -295000 },
    );
    await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/settlements/${huaSettlementId}`)
      .set(auth(s.me.token))
      .expect(204);
    await expectState(s, e4People, e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    // SC-E9/E10：新增非成員與門票；淨額和建議與 spec 的三筆結清相同。
    const peopleBase = `/api/ledgers/${s.ledgerId}/people`;
    const guestResponse = await request(server())
      .post(peopleBase)
      .set(auth(s.me.token))
      .send({ name: '阿美' })
      .expect(201);
    const guest = guestResponse.body as LedgerPerson;
    expect(guest).toMatchObject({ name: '阿美', userId: null, status: 'GUEST' });
    const afterGuestPeople: ExpectedPersonNet[] = [...e4People.slice(0, 3), ['阿美', 'GUEST', 0]];
    await expectState(s, afterGuestPeople, e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    const duplicateGuestResponse = await request(server())
      .post(peopleBase)
      .set(auth(s.me.token))
      .send({ name: '阿美' })
      .expect(409);
    expect((duplicateGuestResponse.body as ApiErrorResponse).errorCode).toBe(
      'LEDGER_PERSON_NAME_TAKEN',
    );
    await expectState(s, afterGuestPeople, e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    const unusedGuestResponse = await request(server())
      .post(peopleBase)
      .set(auth(s.me.token))
      .send({ name: '小美' })
      .expect(201);
    const unusedGuest = unusedGuestResponse.body as LedgerPerson;
    await expectState(s, [...afterGuestPeople, ['小美', 'GUEST', 0]], e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });
    await request(server())
      .delete(`${peopleBase}/${unusedGuest.id}`)
      .set(auth(s.me.token))
      .expect(204);
    await expectState(s, afterGuestPeople, e4Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    const ticketResponse = await createTransaction(s, s.me, {
      type: 'EXPENSE',
      amount: 80000,
      payerPersonId: guest.id,
      note: '門票',
      ledgerSplit: equalSplit([s.people.me.id, guest.id]),
    }).expect(201);
    const ticket = ticketResponse.body as Transaction;
    expect(ticket).toMatchObject({
      type: 'EXPENSE',
      amount: 80000,
      payer: { id: guest.id, name: '阿美', status: 'GUEST' },
      account: null,
      accountPending: false,
    });
    expect(
      ticket.ledgerSplit?.shares.map(({ person: member, share }) => [member.id, share]),
    ).toEqual([
      [s.people.me.id, 40000],
      [guest.id, 40000],
    ]);
    const e9People: ExpectedPersonNet[] = [
      ['我', 'MEMBER', 265000],
      ['小明', 'MEMBER', -100000],
      ['小華', 'MEMBER', -205000],
      ['阿美', 'GUEST', 40000],
    ];
    const e9Suggestions: ExpectedSuggestion[] = [
      { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 205000 },
      { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 60000 },
      { fromPersonId: s.people.ming.id, toPersonId: guest.id, amount: 40000 },
    ];
    await expectState(s, e9People, e9Suggestions, {
      me: -600000,
      ming: -150000,
      hua: -90000,
    });

    const guestSettlementResponse = await createSettlement(s, s.ming, {
      toPersonId: guest.id,
      amount: 40000,
      fromAccountId: s.ming.cashId,
    }).expect(201);
    const guestSettlement = guestSettlementResponse.body as Transaction;
    expect(guestSettlement).toMatchObject({
      type: 'TRANSFER',
      amount: 40000,
      account: { id: s.ming.cashId },
      toAccount: null,
      settlement: {
        from: { id: s.people.ming.id, name: '小明' },
        to: { id: guest.id, name: '阿美' },
      },
    });
    expect(guestSettlement.accountPending).toBe(false);
    const guestSettlementId = guestSettlement.settlement!.id;
    const afterGuestSettlementPeople: ExpectedPersonNet[] = [
      ['我', 'MEMBER', 265000],
      ['小明', 'MEMBER', -60000],
      ['小華', 'MEMBER', -205000],
      ['阿美', 'GUEST', 0],
    ];
    const afterGuestSettlementSuggestions: ExpectedSuggestion[] = [
      { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 205000 },
      { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 60000 },
    ];
    await expectState(s, afterGuestSettlementPeople, afterGuestSettlementSuggestions, {
      me: -600000,
      ming: -190000,
      hua: -90000,
    });

    const guestInUse = await request(server())
      .delete(`${peopleBase}/${guest.id}`)
      .set(auth(s.me.token))
      .expect(409);
    expect((guestInUse.body as ApiErrorResponse).errorCode).toBe('LEDGER_PERSON_IN_USE');
    await expectState(s, afterGuestSettlementPeople, afterGuestSettlementSuggestions, {
      me: -600000,
      ming: -190000,
      hua: -90000,
    });

    const renamedGuestResponse = await request(server())
      .patch(`${peopleBase}/${guest.id}`)
      .set(auth(s.me.token))
      .send({ name: '阿梅' })
      .expect(200);
    const renamedGuest = renamedGuestResponse.body as LedgerPerson;
    expect(renamedGuest).toMatchObject({ id: guest.id, name: '阿梅', status: 'GUEST' });
    const ticketAfterRename = await transactionDetail(s, s.me, ticket.id);
    expect(ticketAfterRename.payer).toMatchObject({ id: guest.id, name: '阿梅' });
    expect(
      ticketAfterRename.ledgerSplit?.shares.find(({ person: member }) => member.id === guest.id)
        ?.person.name,
    ).toBe('阿梅');
    const guestSettlementAfterRename = await transactionDetail(s, s.me, guestSettlement.id);
    expect(guestSettlementAfterRename).toMatchObject({
      type: 'TRANSFER',
      settlement: { id: guestSettlementId, to: { id: guest.id, name: '阿梅' } },
    });
    const filteredByGuest = await transactionList(s, s.me, { payerPersonId: guest.id, limit: 100 });
    expect(filteredByGuest.items.map(({ id }) => id)).toEqual([ticket.id]);
    const allTransactions = await transactionList(s, s.me);
    const settlementRow = allTransactions.items.find(({ id }) => id === guestSettlement.id);
    expect(settlementRow).toMatchObject({
      type: 'TRANSFER',
      settlement: {
        id: guestSettlementId,
        from: { id: s.people.ming.id, name: '小明' },
        to: { id: guest.id, name: '阿梅' },
      },
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', 265000],
        ['小明', 'MEMBER', -60000],
        ['小華', 'MEMBER', -205000],
        ['阿梅', 'GUEST', 0],
      ],
      afterGuestSettlementSuggestions,
      { me: -600000, ming: -190000, hua: -90000 },
    );

    // SC-E19：3c 的 /splits 仍可由共享帳本成員操作；split 明細只回給建立者本人。
    const mingCounterparty = await createCounterparty(app, s.ming, '3c 對象');
    const splitInput: CreateSplitRequest = {
      type: 'EXPENSE',
      ledgerId: s.ledgerId,
      categoryId: s.categoryId,
      total: 10000,
      date: DAY,
      title: '3c 共享帳本回歸',
      payer: null,
      accountId: s.ming.cashId,
      method: 'EQUAL',
      participants: [{ counterpartyId: null }, { counterpartyId: mingCounterparty.id }],
    };
    const splitResponse = await request(server())
      .post('/api/splits')
      .set(auth(s.ming.token))
      .send(splitInput)
      .expect(201);
    const split = splitResponse.body as Split;
    expect(split).toMatchObject({ total: 10000 });
    expect(split.participants.map(({ share }) => share)).toEqual([5000, 5000]);
    const [mingTransactions, meTransactions] = await Promise.all([
      transactionList(s, s.ming),
      transactionList(s, s.me),
    ]);
    const mingSplitTransaction = mingTransactions.items.find(
      ({ split: transactionSplit }) => transactionSplit?.id === split.id,
    );
    expect(mingSplitTransaction).toBeDefined();
    expect(mingSplitTransaction?.type).toBe('EXPENSE');
    expect(
      meTransactions.items.find(({ id }) => id === mingSplitTransaction?.id)?.split,
    ).toBeNull();
    await request(server()).get(`/api/splits/${split.id}`).set(auth(s.me.token)).expect(404);
    const splitForOwner = await request(server())
      .get(`/api/splits/${split.id}`)
      .set(auth(s.ming.token))
      .expect(200);
    expect((splitForOwner.body as Split).id).toBe(split.id);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 265000],
        ['小明', 'MEMBER', -60000],
        ['小華', 'MEMBER', -205000],
        ['阿梅', 'GUEST', 0],
      ],
      afterGuestSettlementSuggestions,
      { me: -600000, ming: -200000, hua: -90000 },
    );

    // SC-E7：更換晚餐付款人時先拒絕缺少帳戶，再以同一個 PATCH 指定我的帳戶。
    const missingNewPayerAccount = await patchTransaction(s, s.me, dinner.id, {
      payerPersonId: s.people.me.id,
    }).expect(400);
    expect((missingNewPayerAccount.body as ApiErrorResponse).errorCode).toBe('ACCOUNT_REQUIRED');
    await expectState(
      s,
      [
        ['我', 'MEMBER', 265000],
        ['小明', 'MEMBER', -60000],
        ['小華', 'MEMBER', -205000],
        ['阿梅', 'GUEST', 0],
      ],
      afterGuestSettlementSuggestions,
      { me: -600000, ming: -200000, hua: -90000 },
    );
    const changedPayerResponse = await patchTransaction(s, s.me, dinner.id, {
      payerPersonId: s.people.me.id,
      accountId: s.me.cashId,
    }).expect(200);
    const dinnerWithChangedPayer = changedPayerResponse.body as Transaction;
    expect(dinnerWithChangedPayer).toMatchObject({
      id: dinner.id,
      payer: { id: s.people.me.id, name: '我' },
      account: { id: s.me.cashId },
      accountPending: false,
    });
    expect(dinnerWithChangedPayer.ledgerSplit?.shares.map(({ share }) => share)).toEqual([
      50000, 50000, 50000,
    ]);
    const afterPayerChangePeople: ExpectedPersonNet[] = [
      ['我', 'MEMBER', 415000],
      ['小明', 'MEMBER', -210000],
      ['小華', 'MEMBER', -205000],
      ['阿梅', 'GUEST', 0],
    ];
    const afterPayerChangeSuggestions: ExpectedSuggestion[] = [
      { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 210000 },
      { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 205000 },
    ];
    await expectState(s, afterPayerChangePeople, afterPayerChangeSuggestions, {
      me: -750000,
      ming: -50000,
      hua: -90000,
    });

    // SC-E14：離開者保留淨額；新交易仍可選他（修訂 2），也可代他結清並改動舊名單。
    await request(server())
      .delete(`/api/ledgers/${s.ledgerId}/members/${s.ming.userId}`)
      .set(auth(s.ming.token))
      .expect(204);
    const afterLeavePeople: ExpectedPersonNet[] = [
      ['我', 'MEMBER', 415000],
      ['小明', 'LEFT', -210000],
      ['小華', 'MEMBER', -205000],
      ['阿梅', 'GUEST', 0],
    ];
    await expectState(s, afterLeavePeople, afterPayerChangeSuggestions, {
      me: -750000,
      ming: -50000,
      hua: -90000,
    });

    const beforeInvalidTransactions = await transactionList(s, s.me);
    const leftPayerResponse = await createTransaction(s, s.me, {
      type: 'EXPENSE',
      amount: 10000,
      payerPersonId: s.people.ming.id,
    }).expect(201);
    const leftPaid = leftPayerResponse.body as Transaction;
    expect(leftPaid.payer?.status).toBe('LEFT');
    expect(leftPaid.account).toBeNull();
    const leftShareResponse = await createTransaction(s, s.me, {
      type: 'EXPENSE',
      amount: 10000,
      accountId: s.me.cashId,
      ledgerSplit: equalSplit([s.people.me.id, s.people.ming.id]),
    }).expect(201);
    const leftShared = leftShareResponse.body as Transaction;
    // 刪掉這兩筆，讓後面的情境沿用離開當下的淨額與餘額。
    for (const id of [leftPaid.id, leftShared.id]) {
      await request(server())
        .delete(`/api/ledgers/${s.ledgerId}/transactions/${id}`)
        .set(auth(s.me.token))
        .expect(204);
    }
    expect((await transactionList(s, s.me)).total).toBe(beforeInvalidTransactions.total);
    await expectState(s, afterLeavePeople, afterPayerChangeSuggestions, {
      me: -750000,
      ming: -50000,
      hua: -90000,
    });

    const leftMemberSettlementResponse = await createSettlement(s, s.me, {
      fromPersonId: s.people.ming.id,
      toPersonId: s.people.me.id,
      amount: 210000,
      toAccountId: s.me.cashId,
    }).expect(201);
    const leftMemberSettlement = leftMemberSettlementResponse.body as Transaction;
    expect(leftMemberSettlement).toMatchObject({
      type: 'TRANSFER',
      amount: 210000,
      account: null,
      toAccount: { id: s.me.cashId },
      settlement: {
        from: { id: s.people.ming.id, name: '小明', status: 'LEFT' },
        to: { id: s.people.me.id, name: '我' },
      },
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', 205000],
        ['小明', 'LEFT', 0],
        ['小華', 'MEMBER', -205000],
        ['阿梅', 'GUEST', 0],
      ],
      [{ fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 205000 }],
      { me: -540000, ming: -50000, hua: -90000 },
    );

    const changedDinnerAmountResponse = await patchTransaction(s, s.me, dinner.id, {
      amount: 180000,
    }).expect(200);
    const dinnerWithChangedAmount = changedDinnerAmountResponse.body as Transaction;
    expect(dinnerWithChangedAmount).toMatchObject({
      id: dinner.id,
      type: 'EXPENSE',
      amount: 180000,
      payer: { id: s.people.me.id, name: '我' },
      account: { id: s.me.cashId },
    });
    expect(
      dinnerWithChangedAmount.ledgerSplit?.shares.map(({ person: member, share }) => [
        member.id,
        member.status,
        share,
      ]),
    ).toEqual([
      [s.people.me.id, 'MEMBER', 60000],
      [s.people.ming.id, 'LEFT', 60000],
      [s.people.hua.id, 'MEMBER', 60000],
    ]);
    await expectState(
      s,
      [
        ['我', 'MEMBER', 225000],
        ['小明', 'LEFT', -10000],
        ['小華', 'MEMBER', -215000],
        ['阿梅', 'GUEST', 0],
      ],
      [
        { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 215000 },
        { fromPersonId: s.people.ming.id, toPersonId: s.people.me.id, amount: 10000 },
      ],
      { me: -570000, ming: -50000, hua: -90000 },
    );

    // SC-E8：移除晚餐名單後，只有交易付款人保留這筆金額。
    const removedDinnerSplitResponse = await patchTransaction(s, s.me, dinner.id, {
      ledgerSplit: null,
    }).expect(200);
    const dinnerWithoutSplit = removedDinnerSplitResponse.body as Transaction;
    expect(dinnerWithoutSplit).toMatchObject({
      id: dinner.id,
      amount: 180000,
      payer: { id: s.people.me.id, name: '我' },
      ledgerSplit: null,
      account: { id: s.me.cashId },
    });
    await expectState(
      s,
      [
        ['我', 'MEMBER', 105000],
        ['小明', 'LEFT', 50000],
        ['小華', 'MEMBER', -155000],
        ['阿梅', 'GUEST', 0],
      ],
      [
        { fromPersonId: s.people.hua.id, toPersonId: s.people.me.id, amount: 105000 },
        { fromPersonId: s.people.hua.id, toPersonId: s.people.ming.id, amount: 50000 },
      ],
      { me: -570000, ming: -50000, hua: -90000 },
    );
  });
});
