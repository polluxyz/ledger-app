import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  CreateDebtEntryRequest,
  CreateDebtEntryResponse,
  DebtEntry,
  LedgerGroup,
  LedgerPerson,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, getCounterparty, linkPair, person, proposals, type Person } from './linking-utils';

/**
 * 3g 的主線情境（spec `phase-3g-debts-inline.md` §5 SC-G1～G6）：一條測試從記第一筆走到
 * 撤銷，驗證新功能串在同一份資料上仍一致——往來紀錄的分段、個人分頁的過濾、差額與還款的
 * 綁定、連動兩邊的同步撤銷、共享帳本的結清清單與計數。
 *
 * 資料照 spec §1：我＝test；明哥（連動到真實使用者「小明」）3/1 借出 300、3/5 還 300、
 * 3/10 借出 500；房東 3/2 借出 93、3/6 還 90 以此結清（差額 −3）；共享帳本「花蓮三日」
 * 照 3f 的四筆轉帳記成結清（不連動帳戶，交易與結清一律不帶帳戶）。金額一律用分。
 *
 * 有一處偏離 spec §1 的資料：SC-G5 之前，明哥要先照一般還款還清 500（3/11）。「以此結清」會把
 * 整個往來餘額歸零（決策 38），明哥欠 500 時直接結清會連這 500 一起沖掉，SC-G5 就測不到「只沖
 * 新借的 93」的情況。這一步在 SC-G1～G4 的斷言之後才做，前面的斷言仍用 spec 的原始資料。
 *
 * 情境的最後一步是 spec §1 第 6 點：撤銷房東 3/6 的還款，綁定的差額一起撤銷，房東餘額回到
 * 93、重新出現在 `personalNonZero`。各功能的邊界（分頁、退出後的寫入限制、授權隔離）分別
 * 在 `debts-history`、`debts-bind`、`ledger-settlements-list`、`debts-inline-isolation`
 * 各自的 e2e，這裡只走主線。
 */
describe('Debts inline scenario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const date = (day: number) => `2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  /** 紀錄是否落在 3 月的指定日。API 回的是 ISO 字串，只比日期部分，不管時間。 */
  const onDay = (entry: DebtEntry, day: number) =>
    entry.date.slice(0, 10) === date(day).slice(0, 10);

  let me: Person;
  let xiaoming: Person;

  async function postEntry(body: CreateDebtEntryRequest): Promise<CreateDebtEntryResponse> {
    const res = await request(server())
      .post('/api/debt-entries')
      .set(auth(me.token))
      .send(body)
      .expect(201);
    return res.body as CreateDebtEntryResponse;
  }

  /** 記一筆之後，讓連動的小明接受他收到的提議。情境裡一來一往，不累積待確認。 */
  async function postAndAccept(body: CreateDebtEntryRequest): Promise<CreateDebtEntryResponse> {
    const created = await postEntry(body);
    const incoming = (await proposals(app, xiaoming, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${incoming.id}/accept`)
      .set(auth(xiaoming.token))
      .send({ record: null })
      .expect(200);
    return created;
  }

  /** 小明接受一筆刪除提議（不產生交易，body 留空）。 */
  async function xiaomingAcceptsDelete(): Promise<void> {
    const incoming = (await proposals(app, xiaoming, 'incoming', 'PENDING'))[0]!;
    await request(server())
      .post(`/api/debt-proposals/${incoming.id}/accept`)
      .set(auth(xiaoming.token))
      .send({})
      .expect(200);
  }

  async function entriesOf(
    who: Person,
    counterpartyId: string,
    query: Record<string, string | number> = {},
  ): Promise<Paginated<DebtEntry>> {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .query(query)
      .set(auth(who.token))
      .expect(200);
    return res.body as Paginated<DebtEntry>;
  }

  async function counterpartyIds(query: Record<string, string>): Promise<string[]> {
    const res = await request(server())
      .get('/api/counterparties')
      .query({ limit: 100, ...query })
      .set(auth(me.token))
      .expect(200);
    return (res.body as Paginated<Counterparty>).items.map((row) => row.id);
  }

  /** 某個對象目前的個人往來餘額（我的角度）。 */
  async function balanceOf(counterpartyId: string): Promise<number> {
    return (await getCounterparty(app, me, counterpartyId)).balance;
  }

  it('SC-G1–G6：分段、過濾、綁定、連動與結清清單依序走完，最後撤銷房東的還款', async () => {
    // ── 資料（spec §1）──────────────────────────────────────────────
    me = await person(app, 'test@example.com', 'test');
    xiaoming = await person(app, 'xiaoming@example.com', '小明');
    // 明哥連動到小明（3f 的設定：花蓮三日的小明指向明哥），先記三筆基礎往來。
    const { aCounterpartyId: mingId, bCounterpartyId: xiaomingsMe } = await linkPair(
      app,
      me,
      xiaoming,
      '明哥',
      null,
    );
    await postAndAccept({
      counterparty: { id: mingId },
      kind: 'LEND',
      amount: 30000,
      date: date(1),
      record: null,
    });
    await postAndAccept({
      counterparty: { id: mingId },
      kind: 'REPAYMENT',
      amount: 30000,
      date: date(5),
      record: null,
    });
    await postAndAccept({
      counterparty: { id: mingId },
      kind: 'LEND',
      amount: 50000,
      date: date(10),
      record: null,
    });

    // 房東：3/2 借出 93、3/6 還 90 以此結清。記進現金，之後才驗得到交易的修改。
    const landlord = await request(server())
      .post('/api/counterparties')
      .set(auth(me.token))
      .send({ name: '房東' })
      .expect(201)
      .then((res) => res.body as Counterparty);
    await postEntry({
      counterparty: { id: landlord.id },
      kind: 'LEND',
      amount: 9300,
      date: date(2),
      record: { ledgerId: me.ledgerId, accountId: me.cashId },
    });
    const repaid = await postEntry({
      counterparty: { id: landlord.id },
      kind: 'REPAYMENT',
      amount: 9000,
      date: date(6),
      settle: true,
      record: { ledgerId: me.ledgerId, accountId: me.cashId },
    });
    const repayment = repaid.entries[0]!;
    const settlement = repaid.entries[1]!;

    // 花蓮三日：不連動帳戶的共享帳本，小明也是 OWNER（最後我才能退出），其餘是客名。
    const hualienId = await request(server())
      .post('/api/ledgers')
      .set(auth(me.token))
      .send({ name: '花蓮三日', kind: 'SHARED', tracksBalance: false })
      .expect(201)
      .then((res) => (res.body as { id: string }).id);
    await request(server())
      .post(`/api/ledgers/${hualienId}/members`)
      .set(auth(me.token))
      .send({ email: xiaoming.email, role: 'OWNER' })
      .expect(201);
    for (const guest of ['小華', '小美', '阿美']) {
      await request(server())
        .post(`/api/ledgers/${hualienId}/people`)
        .set(auth(me.token))
        .send({ name: guest })
        .expect(201);
    }
    const people = await request(server())
      .get(`/api/ledgers/${hualienId}/people`)
      .set(auth(me.token))
      .expect(200)
      .then((res) => res.body as LedgerPerson[]);
    const personOf = (name: string) => people.find((row) => row.name === name)!;

    // 3f 的四筆轉帳記成結清（金額：139400、51200、40000、20000），日期錯開讓新到舊可驗。
    async function settle(
      from: string,
      to: string,
      amount: number,
      day: number,
    ): Promise<Transaction> {
      return request(server())
        .post(`/api/ledgers/${hualienId}/settlements`)
        .set(auth(me.token))
        .send({
          fromPersonId: personOf(from).id,
          toPersonId: personOf(to).id,
          amount,
          date: date(day),
        })
        .expect(201)
        .then((res) => res.body as Transaction);
    }
    const huaToMe = await settle('小華', 'test', 139400, 7);
    const mingToMe = await settle('小明', 'test', 51200, 8);
    const mingToMei = await settle('小明', '小美', 40000, 9);
    const mingToAMei = await settle('小明', '阿美', 20000, 10);

    // ── SC-G1：明哥的分段（§5 決策 153）────────────────────────────
    const outstanding = await entriesOf(me, mingId, { section: 'outstanding' });
    expect(outstanding.total).toBe(1);
    expect(
      outstanding.items.map(({ kind, delta, balanceAfter }) => [kind, delta, balanceAfter]),
    ).toEqual([['LEND', 50000, 50000]]);

    const history = await entriesOf(me, mingId, { section: 'history' });
    expect(history.total).toBe(2);
    expect(
      history.items.map(({ kind, delta, balanceAfter }) => [kind, delta, balanceAfter]),
    ).toEqual([
      ['COLLECT', -30000, 0],
      ['LEND', 30000, 30000],
    ]);

    const allEntries = await entriesOf(me, mingId);
    expect(allEntries.total).toBe(3);
    expect(allEntries.items.map(({ date: entryDate }) => entryDate.slice(0, 10))).toEqual([
      '2026-03-10',
      '2026-03-05',
      '2026-03-01',
    ]);

    // ── SC-G2：個人分頁與歷史分頁的過濾（W157、W161）───────────────
    expect(await counterpartyIds({ personalNonZero: 'true' })).toEqual([mingId]);
    const withHistory = await counterpartyIds({ hasHistory: 'true' });
    expect([...withHistory].sort()).toEqual([landlord.id, mingId].sort());

    // ── SC-G3：差額綁在還款上，不能單獨撤銷（決策 156、157）─────────
    expect(repayment).toMatchObject({ kind: 'COLLECT', delta: -9000 });
    expect(settlement).toMatchObject({ kind: 'SETTLEMENT', delta: -300 });
    expect(settlement.settlesEntryId).toBe(repayment.id);
    // 同一天的差額固定排在還款後面（新到舊：差額、還款、借出）。
    const landlordPage = await entriesOf(me, landlord.id);
    expect(landlordPage.total).toBe(3);
    expect(
      landlordPage.items.map(({ kind, delta, balanceAfter }) => [kind, delta, balanceAfter]),
    ).toEqual([
      ['SETTLEMENT', -300, 0],
      ['COLLECT', -9000, 300],
      ['LEND', 9300, 9300],
    ]);
    expect(await balanceOf(landlord.id)).toBe(0);

    const refused = await request(server())
      .delete(`/api/debt-entries/${settlement.id}`)
      .set(auth(me.token));
    expect(refused.status).toBe(409);
    expect((refused.body as { errorCode: string }).errorCode).toBe('SETTLEMENT_BOUND_TO_REPAYMENT');

    // ── SC-G4：改還款金額時差額重算，餘額不動（決策 158）────────────
    const transactionId = repayment.transactionId!;
    async function repaymentTransactionAmount(): Promise<number> {
      return request(server())
        .get(`/api/ledgers/${me.ledgerId}/transactions`)
        .set(auth(me.token))
        .expect(200)
        .then(
          (res) =>
            (res.body as Paginated<Transaction>).items.find((row) => row.id === transactionId)!
              .amount,
        );
    }
    const byKind = (list: DebtEntry[], kind: DebtEntry['kind']) =>
      list.find((entry) => entry.kind === kind);

    // 還 91：差額 −2。
    await request(server())
      .patch(`/api/debt-entries/${repayment.id}`)
      .set(auth(me.token))
      .send({ amount: 9100 })
      .expect(200);
    expect(byKind((await entriesOf(me, landlord.id)).items, 'SETTLEMENT')).toMatchObject({
      delta: -200,
      settlesEntryId: repayment.id,
    });
    expect(await balanceOf(landlord.id)).toBe(0);
    expect(await repaymentTransactionAmount()).toBe(9100);

    // 還 95 > 欠 93：差額方向反過來（多收 2）。
    await request(server())
      .patch(`/api/debt-entries/${repayment.id}`)
      .set(auth(me.token))
      .send({ amount: 9500 })
      .expect(200);
    expect(byKind((await entriesOf(me, landlord.id)).items, 'SETTLEMENT')).toMatchObject({
      delta: 200,
      settlesEntryId: repayment.id,
    });
    expect(await balanceOf(landlord.id)).toBe(0);
    expect(await repaymentTransactionAmount()).toBe(9500);

    // 還 93 剛好還清：差額撤銷，之後是一般還款。
    await request(server())
      .patch(`/api/debt-entries/${repayment.id}`)
      .set(auth(me.token))
      .send({ amount: 9300 })
      .expect(200);
    const afterExact = (await entriesOf(me, landlord.id)).items;
    expect(byKind(afterExact, 'SETTLEMENT')).toBeUndefined();
    expect(byKind(afterExact, 'COLLECT')).toMatchObject({ delta: -9300 });
    expect(await balanceOf(landlord.id)).toBe(0);
    expect(await repaymentTransactionAmount()).toBe(9300);

    // ── SC-G5：連動兩邊的綁定與撤銷（§5）──────────────────────────
    // 「以此結清」會把整個往來餘額歸零（決策 38），差額 = −(寫入還款後的餘額)。明哥現在欠我 500，
    // 直接結清會連這 500 一起沖掉，差額變成 −50300，跟 SC-G5 要測的「只沖這次借的 93」不同。
    // 所以先讓明哥照一般還款還清 500（3/11），餘額歸零，之後的結清只沾到新借的 93。
    await postAndAccept({
      counterparty: { id: mingId },
      kind: 'REPAYMENT',
      amount: 50000,
      date: date(11),
      record: null,
    });
    expect(await balanceOf(mingId)).toBe(0);

    // 再借明哥 93（3/12），以此結清還 90（3/13）：差額 −3 綁在這筆還款上。
    // 小明接受後，他那邊的還款與差額也要綁在一起。
    await postAndAccept({
      counterparty: { id: mingId },
      kind: 'LEND',
      amount: 9300,
      date: date(12),
      record: null,
    });
    const linkedRepaid = await postAndAccept({
      counterparty: { id: mingId },
      kind: 'REPAYMENT',
      amount: 9000,
      date: date(13),
      settle: true,
      record: null,
    });
    const myLinkedRepayment = linkedRepaid.entries[0]!;
    const mySettlement = linkedRepaid.entries[1]!;
    expect(mySettlement).toMatchObject({
      kind: 'SETTLEMENT',
      delta: -300,
      settlesEntryId: myLinkedRepayment.id,
    });
    expect(await balanceOf(mingId)).toBe(0);

    // 小明那邊是 REPAY（他還我），差額 +300（對他有利），兩筆都綁在一起。
    const hisList = (await entriesOf(xiaoming, xiaomingsMe)).items;
    const hisRepayment = hisList.find((entry) => entry.kind === 'REPAY' && onDay(entry, 13))!;
    expect(hisList.find((entry) => entry.kind === 'SETTLEMENT' && onDay(entry, 13))).toMatchObject({
      delta: 300,
      settlesEntryId: hisRepayment.id,
    });
    expect((await getCounterparty(app, xiaoming, xiaomingsMe)).balance).toBe(0);

    // 我撤銷還款（差額一起撤銷）；小明接受刪除提議後，他那邊的還款與差額也撤銷。
    await request(server())
      .delete(`/api/debt-entries/${myLinkedRepayment.id}`)
      .set(auth(me.token))
      .expect(204);
    await xiaomingAcceptsDelete();

    const myAfter = (await entriesOf(me, mingId)).items;
    expect(myAfter.filter((entry) => entry.kind === 'SETTLEMENT')).toEqual([]);
    expect(myAfter.filter((entry) => onDay(entry, 13))).toEqual([]);
    const hisAfter = (await entriesOf(xiaoming, xiaomingsMe)).items;
    expect(hisAfter.filter((entry) => entry.kind === 'SETTLEMENT')).toEqual([]);
    expect(hisAfter.filter((entry) => onDay(entry, 13))).toEqual([]);
    // 撤銷後只剩 3/12 借出的 93：我 9300、小明 −9300。
    expect(await balanceOf(mingId)).toBe(9300);
    expect((await getCounterparty(app, xiaoming, xiaomingsMe)).balance).toBe(-9300);

    // ── SC-G6：結清清單與 hasSettlements（§5）──────────────────────
    const settlementsPage = await request(server())
      .get(`/api/ledgers/${hualienId}/settlements`)
      .set(auth(me.token))
      .expect(200)
      .then((res) => res.body as Paginated<Transaction>);
    expect(settlementsPage.total).toBe(4);
    expect(settlementsPage.items.map((row) => row.id)).toEqual([
      mingToAMei.id,
      mingToMei.id,
      mingToMe.id,
      huaToMe.id,
    ]);
    expect(settlementsPage.items[0]!.settlement).toMatchObject({
      from: { id: personOf('小明').id },
      to: { id: personOf('阿美').id },
    });
    expect(settlementsPage.items[2]!.settlement).toMatchObject({
      from: { id: personOf('小明').id },
      to: { id: personOf('test').id },
    });

    const groupsBefore = await request(server())
      .get('/api/ledger-groups')
      .query({ hasSettlements: 'true' })
      .set(auth(me.token))
      .expect(200)
      .then((res) => res.body as LedgerGroup[]);
    const groupBefore = groupsBefore.find((group) => group.ledger.id === hualienId)!;
    expect(groupBefore.ledger.left).toBe(false);
    expect(groupBefore.settlementCount).toBe(4);

    // 退出花蓮三日：清單只剩我是任一方的結清，計數跟著縮。
    await request(server())
      .delete(`/api/ledgers/${hualienId}/members/${me.userId}`)
      .set(auth(me.token))
      .expect(204);
    const afterLeave = await request(server())
      .get(`/api/ledgers/${hualienId}/settlements`)
      .set(auth(me.token))
      .expect(200)
      .then((res) => res.body as Paginated<Transaction>);
    expect(afterLeave.total).toBe(2);
    expect(afterLeave.items.map((row) => row.id)).toEqual([mingToMe.id, huaToMe.id]);

    const groupsAfter = await request(server())
      .get('/api/ledger-groups')
      .query({ hasSettlements: 'true' })
      .set(auth(me.token))
      .expect(200)
      .then((res) => res.body as LedgerGroup[]);
    const groupAfter = groupsAfter.find((group) => group.ledger.id === hualienId)!;
    expect(groupAfter.ledger.left).toBe(true);
    expect(groupAfter.settlementCount).toBe(2);

    // ── spec §1 第 6 點：撤銷房東 3/6 的還款 ───────────────────────
    // SC-G4 把還款改成 93 時差額已經撤銷（之後是一般還款）。先把 3/6 還原成「還 90 以此
    // 結清」：撤掉那筆（一般還款可以單獨撤銷），照原日期重記一次。
    await request(server())
      .delete(`/api/debt-entries/${repayment.id}`)
      .set(auth(me.token))
      .expect(204);
    expect(await balanceOf(landlord.id)).toBe(9300);

    const reRecorded = await postEntry({
      counterparty: { id: landlord.id },
      kind: 'REPAYMENT',
      amount: 9000,
      date: date(6),
      settle: true,
      record: { ledgerId: me.ledgerId, accountId: me.cashId },
    });
    const finalRepayment = reRecorded.entries[0]!;
    expect(reRecorded.entries[1]!.settlesEntryId).toBe(finalRepayment.id);
    expect(await balanceOf(landlord.id)).toBe(0);

    // 撤銷 3/6 的還款：差額一起撤銷，房東只剩 3/2 的借出，回到「個人」分頁。
    await request(server())
      .delete(`/api/debt-entries/${finalRepayment.id}`)
      .set(auth(me.token))
      .expect(204);
    const landlordFinal = await entriesOf(me, landlord.id);
    expect(landlordFinal.total).toBe(1);
    expect(landlordFinal.items[0]).toMatchObject({
      kind: 'LEND',
      delta: 9300,
      balanceAfter: 9300,
    });
    expect(await balanceOf(landlord.id)).toBe(9300);
    expect(await counterpartyIds({ personalNonZero: 'true' })).toContain(landlord.id);
  });
});
