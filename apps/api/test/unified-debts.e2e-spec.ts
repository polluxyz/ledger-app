import { INestApplication } from '@nestjs/common';
import type {
  ApiErrorResponse,
  Counterparty,
  LedgerDetail,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  SettlementSummary,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, linkPair, person, type Person } from './linking-utils';

/**
 * 3f 的 API 情境 e2e（spec §5 SC-F1～F9）：用 §1 的「花蓮三日」數字，把個人往來、帳本
 * 分帳、指向、結清與退出串成一條情境，驗借還總額、帳本群組與結清檢視共用同一組數字
 * （決策 141～145）。所有業務資料都經 HTTP 建立。
 *
 * 隔離面的細節（SC-F9、F10 的 404／409 矩陣、查詢參數不能放寬範圍）由
 * `unified-debts-isolation.e2e-spec.ts` 覆蓋，這裡聚焦情境主線的數字與狀態轉移。
 * 金額一律是分：借 500 元＝50000、小華欠 1,394 元＝139400。
 */
describe('Unified debts scenario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const DAY = '2026-10-06T12:00:00.000Z';
  const server = () => httpServer(app);

  /** 情境裡的帳本人物；people 以名字換回 id，後續斷言一律用 id。 */
  interface Scene {
    me: Person;
    ming: Person;
    hua: Person;
    mei: Person;
    /** 明哥：我對小明的連動對象（個人往來 +花50000 的那一筆）。 */
    mingCounterpartyId: string;
    /** 房東：我另建的未連動對象，供手動指向用。 */
    landlord: Counterparty;
    ledgerId: string;
    categoryId: string;
    people: {
      me: LedgerPerson;
      ming: LedgerPerson;
      hua: LedgerPerson;
      mei: LedgerPerson;
      aMei: LedgerPerson;
      aJie: LedgerPerson;
    };
  }

  async function scene(): Promise<Scene> {
    const me = await person(app, 'me@example.com', '我');
    const ming = await person(app, 'ming@example.com', '小明');
    const hua = await person(app, 'hua@example.com', '小華');
    const mei = await person(app, 'mei@example.com', '小美');

    const { aCounterpartyId: mingCounterpartyId } = await linkPair(app, me, ming, '明哥', null);
    const landlord = await createCounterparty(app, me, '房東');

    // 個人往來：我借明哥 500 元（LEND → delta +50000），不記進任何帳本。
    await request(server())
      .post('/api/debt-entries')
      .set(auth(me.token))
      .send({
        counterparty: { id: mingCounterpartyId },
        kind: 'LEND',
        amount: 50000,
        date: DAY,
        record: null,
      })
      .expect(201);

    // 花蓮三日不連動帳戶（tracksBalance: false）：交易與結清一律不帶帳戶。
    const ledger = await request(server())
      .post('/api/ledgers')
      .set(auth(me.token))
      .send({ name: '花蓮三日', kind: 'SHARED', tracksBalance: false })
      .expect(201);
    const ledgerId = (ledger.body as { id: string }).id;

    for (const member of [ming, hua, mei]) {
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(me.token))
        .send({ email: member.email, role: 'EDITOR' })
        .expect(201);
    }
    for (const guestName of ['阿美', '阿傑']) {
      await request(server())
        .post(`/api/ledgers/${ledgerId}/people`)
        .set(auth(me.token))
        .send({ name: guestName })
        .expect(201);
    }

    const listed = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(me.token))
      .expect(200);
    const byName = (name: string) => {
      const found = (listed.body as LedgerPerson[]).find((row) => row.name === name);
      if (!found) throw new Error(`Expected a ledger person named ${name}.`);
      return found;
    };

    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(me.token))
      .expect(200);

    return {
      me,
      ming,
      hua,
      mei,
      mingCounterpartyId,
      landlord,
      ledgerId,
      categoryId: (categories.body as Array<{ id: string }>)[0]!.id,
      people: {
        me: byName('我'),
        ming: byName('小明'),
        hua: byName('小華'),
        mei: byName('小美'),
        aMei: byName('阿美'),
        aJie: byName('阿傑'),
      },
    };
  }

  async function counterpartyRow(who: Person, id: string): Promise<Counterparty> {
    const response = await request(server())
      .get(`/api/counterparties/${id}`)
      .set(auth(who.token))
      .expect(200);
    return response.body as Counterparty;
  }

  async function counterpartiesPage(
    who: Person,
    nonZero = false,
  ): Promise<Paginated<Counterparty>> {
    const response = await request(server())
      .get('/api/counterparties')
      .query({ limit: 100, ...(nonZero ? { nonZero: 'true' } : {}) })
      .set(auth(who.token))
      .expect(200);
    return response.body as Paginated<Counterparty>;
  }

  async function groups(who: Person, unpointed = false): Promise<LedgerGroup[]> {
    const response = await request(server())
      .get('/api/ledger-groups')
      .query(unpointed ? { unpointed: 'true' } : {})
      .set(auth(who.token))
      .expect(200);
    return response.body as LedgerGroup[];
  }

  /** 群組裡以 id 取一位，少了就直接炸掉（情境裡每個人都該在）。 */
  function personRow(group: LedgerGroup, personId: string) {
    const found = group.people.find(({ person }) => person.id === personId);
    if (!found) throw new Error(`Expected person ${personId} in the group.`);
    return found;
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

  it('SC-F1–F7、F9：花蓮三日貫穿總額、指向、結清與退出，數字與結清檢視一致', async () => {
    const s = await scene();
    const { me, ming, ledgerId, categoryId, people } = s;

    // 三筆支出（金額單位：分）。我付的由我記；小美、阿美付款以 payerPersonId 指定，
    // 名單刻意都不含我，讓「跟我有關的轉帳」只能來自結清算法。
    const lodging = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(me.token))
      .send({
        type: 'EXPENSE',
        amount: 190600,
        date: DAY,
        categoryId,
        title: '住宿',
        ledgerSplit: {
          method: 'AMOUNT',
          shares: [
            { personId: people.hua.id, amount: 139400 },
            { personId: people.ming.id, amount: 51200 },
          ],
        },
      })
      .expect(201);
    const snack = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(s.mei.token))
      .send({
        type: 'EXPENSE',
        amount: 40000,
        date: DAY,
        categoryId,
        title: '點心',
        payerPersonId: people.mei.id,
        ledgerSplit: { method: 'AMOUNT', shares: [{ personId: people.ming.id, amount: 40000 }] },
      })
      .expect(201);
    const ticket = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(me.token))
      .send({
        type: 'EXPENSE',
        amount: 20000,
        date: DAY,
        categoryId,
        title: '門票',
        payerPersonId: people.aMei.id,
        ledgerSplit: { method: 'AMOUNT', shares: [{ personId: people.ming.id, amount: 20000 }] },
      })
      .expect(201);

    // 結清檢視的建議固定為 spec §1 的四筆（3e 算法不變，SC-F12）。之後的所有總額
    // 都從這份建議取「我付或我收」的轉帳（決策 142），所以先在這裡鎖死基準。
    const summaryResponse = await request(server())
      .get(`/api/ledgers/${ledgerId}/settlement-summary`)
      .set(auth(me.token))
      .expect(200);
    expect((summaryResponse.body as SettlementSummary).suggestions).toEqual([
      { fromPersonId: people.hua.id, toPersonId: people.me.id, amount: 139400 },
      { fromPersonId: people.ming.id, toPersonId: people.me.id, amount: 51200 },
      { fromPersonId: people.ming.id, toPersonId: people.mei.id, amount: 40000 },
      { fromPersonId: people.ming.id, toPersonId: people.aMei.id, amount: 20000 },
    ]);

    // SC-F1：明哥＝個人往來 50000＋花蓮三日 51200＝101200，全程沒有任何明確指向。
    const mingRow = await counterpartyRow(me, s.mingCounterpartyId);
    expect(mingRow.balance).toBe(50000);
    expect(mingRow.ledgerParts).toEqual([
      {
        ledgerId,
        ledgerName: '花蓮三日',
        personId: people.ming.id,
        personName: '小明',
        amount: 51200,
        left: false,
      },
    ]);
    expect(mingRow.totalBalance).toBe(101200);

    // SC-F2：unpointed 只剩小華（小美、阿美、阿傑跟我之間沒有轉帳）；完整群組列出
    // 除了我以外的五人，小明自動指向明哥。
    const unpointedBefore = await groups(me, true);
    expect(unpointedBefore).toHaveLength(1);
    expect(unpointedBefore[0]!.people.map(({ person, amount }) => [person.id, amount])).toEqual([
      [people.hua.id, 139400],
    ]);

    const fullGroups = await groups(me);
    expect(fullGroups).toHaveLength(1);
    expect(fullGroups[0]!.ledger).toEqual({ id: ledgerId, name: '花蓮三日', left: false });
    expect(fullGroups[0]!.people.map(({ person, amount }) => [person.id, amount])).toEqual([
      [people.ming.id, 51200],
      [people.hua.id, 139400],
      [people.mei.id, 0],
      [people.aMei.id, 0],
      [people.aJie.id, 0],
    ]);
    expect(personRow(fullGroups[0]!, people.ming.id).pointer).toEqual({
      counterpartyId: s.mingCounterpartyId,
      auto: true,
    });

    // SC-F3：小華指向房東 → 金額掛到房東身上、unpointed 群組消失；刪掉設定回到群組。
    const pointed = await putPointer(me, ledgerId, people.hua.id, s.landlord.id).expect(200);
    expect(pointed.body).toEqual({ counterpartyId: s.landlord.id, auto: false });

    const landlordRow = await counterpartyRow(me, s.landlord.id);
    expect(landlordRow.balance).toBe(0);
    expect(landlordRow.ledgerParts).toEqual([
      {
        ledgerId,
        ledgerName: '花蓮三日',
        personId: people.hua.id,
        personName: '小華',
        amount: 139400,
        left: false,
      },
    ]);
    expect(landlordRow.totalBalance).toBe(139400);
    expect(await groups(me, true)).toEqual([]);

    await deletePointer(me, ledgerId, people.hua.id).expect(200);
    expect((await groups(me, true))[0]!.people.map(({ person }) => person.id)).toEqual([
      people.hua.id,
    ]);

    // SC-F4：小明明確「不指向」→ 明哥只剩個人往來，小明回到 unpointed；刪掉設定
    // 回到自動指向明哥。
    const cleared = await putPointer(me, ledgerId, people.ming.id, null).expect(200);
    expect(cleared.body).toEqual({ counterpartyId: null, auto: false });

    const mingCleared = await counterpartyRow(me, s.mingCounterpartyId);
    expect(mingCleared.ledgerParts).toEqual([]);
    expect(mingCleared.totalBalance).toBe(50000);
    expect(
      (await groups(me, true))[0]!.people.map(({ person, amount }) => [person.id, amount]),
    ).toEqual([
      [people.ming.id, 51200],
      [people.hua.id, 139400],
    ]);

    const restored = await deletePointer(me, ledgerId, people.ming.id).expect(200);
    expect(restored.body).toEqual({ counterpartyId: s.mingCounterpartyId, auto: true });
    expect((await counterpartyRow(me, s.mingCounterpartyId)).totalBalance).toBe(101200);
    expect((await groups(me, true))[0]!.people.map(({ person }) => person.id)).toEqual([
      people.hua.id,
    ]);

    // SC-F5：刪掉被指向的房東（沒有往來紀錄，可刪）→ 指向跟著清掉，小華回到群組。
    await putPointer(me, ledgerId, people.hua.id, s.landlord.id).expect(200);
    await request(server())
      .delete(`/api/counterparties/${s.landlord.id}`)
      .set(auth(me.token))
      .expect(204);
    expect((await groups(me, true))[0]!.people.map(({ person }) => person.id)).toEqual([
      people.hua.id,
    ]);

    // SC-F6：小明結清他欠我的 512 → 明哥的帳本部分歸零，只剩個人往來（之後的斷言
    // 都用更新後的數字：剩下小華欠我 139400）。
    const settled = await request(server())
      .post(`/api/ledgers/${ledgerId}/settlements`)
      .set(auth(ming.token))
      .send({ toPersonId: people.me.id, amount: 51200, date: DAY })
      .expect(201);
    const mingSettled = await counterpartyRow(me, s.mingCounterpartyId);
    expect(mingSettled.ledgerParts).toEqual([]);
    expect(mingSettled.totalBalance).toBe(50000);

    // SC-F7：兩清的對象不進 nonZero 清單。重建的房東 0 元被排除；結清後帳本部分
    // 歸零的明哥還有個人往來 50000，仍要列出。
    const landlordAgain = await createCounterparty(app, me, '房東');
    const nonZero = await counterpartiesPage(me, true);
    expect(nonZero.items.map(({ id }) => id)).toContain(s.mingCounterpartyId);
    expect(nonZero.items.map(({ id }) => id)).not.toContain(landlordAgain.id);
    const allRows = await counterpartiesPage(me);
    expect(allRows.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([s.mingCounterpartyId, landlordAgain.id]),
    );
    expect((await counterpartyRow(me, landlordAgain.id)).totalBalance).toBe(0);

    // SC-F9 前置：把小華指向重建的房東，退出後才有「掛在對象上的帳本金額」可驗。
    await putPointer(me, ledgerId, people.hua.id, landlordAgain.id).expect(200);

    // SC-F9：最後一位 OWNER 不能直接退出（既有規則）→ 先把 OWNER 給小明再退出。
    const premature = await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${me.userId}`)
      .set(auth(me.token));
    expect(premature.status).toBe(409);
    expect((premature.body as ApiErrorResponse).errorCode).toBe('LAST_OWNER_CANNOT_LEAVE');

    await request(server())
      .patch(`/api/ledgers/${ledgerId}/members/${ming.userId}`)
      .set(auth(me.token))
      .send({ role: 'OWNER' })
      .expect(200);
    await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${me.userId}`)
      .set(auth(me.token))
      .expect(204);

    // 退出後：總額照樣有花蓮三日的金額，並標記 left（決策 151、W133）。
    const landlordAfter = await counterpartyRow(me, landlordAgain.id);
    expect(landlordAfter.ledgerParts).toEqual([
      {
        ledgerId,
        ledgerName: '花蓮三日',
        personId: people.hua.id,
        personName: '小華',
        amount: 139400,
        left: true,
      },
    ]);
    expect(landlordAfter.totalBalance).toBe(139400);
    const groupsAfter = await groups(me);
    expect(groupsAfter).toHaveLength(1);
    expect(groupsAfter[0]!.ledger).toEqual({ id: ledgerId, name: '花蓮三日', left: true });
    expect(groupsAfter[0]!.people).toEqual([
      {
        person: { id: people.hua.id, name: '小華', userId: s.hua.userId, status: 'MEMBER' },
        amount: 139400,
        pointer: { counterpartyId: landlordAgain.id, auto: false },
      },
    ]);

    const detail = await request(server())
      .get(`/api/ledgers/${ledgerId}`)
      .set(auth(me.token))
      .expect(200);
    expect(detail.body as LedgerDetail).toMatchObject({
      name: '花蓮三日',
      left: true,
      members: [],
    });

    // 交易列表只回我付的（住宿）與結清有我的（小明→我）；名單只有小明的兩筆看不到。
    const visible = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .query({ limit: 100 })
      .set(auth(me.token))
      .expect(200);
    const visiblePage = visible.body as Paginated<Transaction>;
    const lodgingId = (lodging.body as Transaction).id;
    const settlementId = (settled.body as Transaction).id;
    expect(visiblePage.total).toBe(2);
    expect(visiblePage.items.map(({ id }) => id).sort()).toEqual([lodgingId, settlementId].sort());
    expect(visiblePage.items.map(({ id }) => id)).not.toContain((snack.body as Transaction).id);
    expect(visiblePage.items.map(({ id }) => id)).not.toContain((ticket.body as Transaction).id);

    // 其餘帳本端點照舊 404；設定指向回 409 LEDGER_LEFT。
    await request(server()).get(`/api/ledgers/${ledgerId}/people`).set(auth(me.token)).expect(404);
    const leftWrite = await putPointer(me, ledgerId, people.hua.id, landlordAgain.id);
    expect(leftWrite.status).toBe(409);
    expect((leftWrite.body as ApiErrorResponse).errorCode).toBe('LEDGER_LEFT');
  });

  // SC-F8 用一本新的共享帳本做，避免影響上面「花蓮三日」的數字。
  it('SC-F8：從對象加成員與建虛擬成員，兩種入口共用一本新帳本', async () => {
    const me = await person(app, 'me@example.com', '我');
    const ming = await person(app, 'ming@example.com', '小明');
    const { aCounterpartyId: mingId } = await linkPair(app, me, ming, '明哥', null);
    const landlord = await createCounterparty(app, me, '房東');
    const ledgerId = await createSharedLedger(app, me.token, '家庭帳本');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(me.token))
      .send({ email: ming.email, role: 'EDITOR' })
      .expect(201);

    // 小明已在帳本裡：走對象入口一樣回既有的「已是成員」錯誤。
    const duplicate = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(me.token))
      .send({ counterpartyId: mingId, role: 'EDITOR' });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as ApiErrorResponse).errorCode).toBe('ALREADY_MEMBER');

    // 未連動的房東不能當成員入口（前端拿不到 email，後端也無帳號可加）。
    const unlinked = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(me.token))
      .send({ counterpartyId: landlord.id, role: 'EDITOR' });
    expect(unlinked.status).toBe(400);
    expect((unlinked.body as ApiErrorResponse).errorCode).toBe('COUNTERPARTY_NOT_LINKED');

    // 建虛擬成員同時替我設定指向：一個請求落地兩件事（spec §4.3）。
    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(me.token))
      .send({ name: '房東', counterpartyId: landlord.id })
      .expect(201);
    const guest = created.body as LedgerPerson;
    expect(guest).toMatchObject({ name: '房東', userId: null, status: 'GUEST' });

    const group = (await groups(me)).find(({ ledger }) => ledger.id === ledgerId)!;
    expect(personRow(group, guest.id).pointer).toEqual({
      counterpartyId: landlord.id,
      auto: false,
    });
  });
});
