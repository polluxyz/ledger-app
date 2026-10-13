import { INestApplication } from '@nestjs/common';
import type { Counterparty, DebtEntry, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, getCounterparty, linkPair, person, proposals, type Person } from './linking-utils';

/**
 * 還款與結清差額綁在一起（spec 3g 決策 156～158、SC-G3～G5）。
 *
 * 這個 suite 驗證三件事：
 * 1. **綁定**：「以此結清」產生的差額 `settlesEntryId` 指向那筆還款；接受對方的提議也一樣。
 * 2. **撤銷**：撤銷還款時差額在同一個資料庫交易裡一起撤銷（餘額回到記這筆之前）；綁定的差額
 *    不能單獨撤銷（409 `SETTLEMENT_BOUND_TO_REPAYMENT`）；沒綁定的舊差額照舊可以單獨撤銷。
 * 3. **重算**：改還款金額時差額跟著重算，餘額仍然歸零；改成超過欠款差額方向反過來；改成剛好
 *    還清差額撤銷。還款那筆的交易金額每次都等於新金額。
 *
 * 策略：spec §1 的「房東」資料（借出 93、還 90 以此結清、差額 −3）走真正的 HTTP；SC-G5 用
 * `linkPair` 連動兩個使用者，驗到對方那邊的差額。金額一律用分（借出 9300、還 9000）。
 */
describe('Debt entries bound to settlements (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const LEND_DATE = '2026-03-02T12:00:00.000Z';
  const REPAY_DATE = '2026-03-06T12:00:00.000Z';

  let me: Person;
  let landlord: Counterparty;

  async function entries(who: Person, counterpartyId: string): Promise<DebtEntry[]> {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<DebtEntry>).items;
  }

  async function balance(who: Person, counterpartyId: string): Promise<number> {
    return (await getCounterparty(app, who, counterpartyId)).balance;
  }

  function byKind(list: DebtEntry[], kind: DebtEntry['kind']): DebtEntry | undefined {
    return list.find((entry) => entry.kind === kind);
  }

  /** 記一筆往來。`record: true` 才記進帳本（為了驗交易金額）。 */
  async function post(who: Person, body: Record<string, unknown>, record = false) {
    return request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({
        date: REPAY_DATE,
        record: record ? { ledgerId: who.ledgerId, accountId: who.cashId } : null,
        ...body,
      });
  }

  /** 那筆交易目前的金額——驗「還款的交易金額等於新金額」。 */
  async function transactionAmount(who: Person, transactionId: string): Promise<number> {
    const res = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/transactions`)
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<Transaction>).items.find((item) => item.id === transactionId)!
      .amount;
  }

  /** 房東的基底資料（spec §1）：3/2 借出 9300、3/6 還 9000 以此結清。回傳還款那一筆。 */
  async function landlordData(record = false): Promise<DebtEntry> {
    me = await person(app, 'me@example.com', 'Me');
    const created = await request(server())
      .post('/api/counterparties')
      .set(auth(me.token))
      .send({ name: '房東' })
      .expect(201);
    landlord = created.body as Counterparty;

    await post(
      me,
      { counterparty: { id: landlord.id }, kind: 'LEND', amount: 9300, date: LEND_DATE },
      record,
    ).then((res) => expect(res.status).toBe(201));
    const repaid = await post(
      me,
      { counterparty: { id: landlord.id }, kind: 'REPAYMENT', amount: 9000, settle: true },
      record,
    );
    expect(repaid.status).toBe(201);
    return (repaid.body as { entries: DebtEntry[] }).entries[0]!;
  }

  describe('SC-G3: the settlement belongs to the repayment', () => {
    it('binds the settlement, withdraws it with the repayment, and refuses a solo withdrawal', async () => {
      const repayment = await landlordData();
      expect(repayment).toMatchObject({ kind: 'COLLECT', delta: -9000 });

      // 差額 −300 指向那筆還款，餘額歸零。
      const list = await entries(me, landlord.id);
      const settlement = byKind(list, 'SETTLEMENT')!;
      expect(settlement).toMatchObject({ delta: -300, settlesEntryId: repayment.id });
      expect(await balance(me, landlord.id)).toBe(0);

      // 差額不能單獨撤銷（決策 157）。
      const refused = await request(server())
        .delete(`/api/debt-entries/${settlement.id}`)
        .set(auth(me.token));
      expect(refused.status).toBe(409);
      expect((refused.body as { errorCode: string }).errorCode).toBe(
        'SETTLEMENT_BOUND_TO_REPAYMENT',
      );

      // 撤銷還款：差額一起撤銷，房東餘額回到 9300，只剩借出那一筆（決策 156）。
      await request(server())
        .delete(`/api/debt-entries/${repayment.id}`)
        .set(auth(me.token))
        .expect(204);
      const after = await entries(me, landlord.id);
      expect(after.map((entry) => entry.kind)).toEqual(['LEND']);
      expect(await balance(me, landlord.id)).toBe(9300);
    });

    it('still withdraws an unbound (pre-3g) settlement on its own', async () => {
      // 直接用資料庫種一筆 3g 之前的差額（settlesEntryId = null）：schema 允許，行為照舊。
      await landlordData();
      const unbound = await prisma.debtEntry.create({
        data: {
          counterpartyId: landlord.id,
          kind: 'SETTLEMENT',
          delta: -100,
          date: new Date(REPAY_DATE),
        },
      });

      await request(server())
        .delete(`/api/debt-entries/${unbound.id}`)
        .set(auth(me.token))
        .expect(204);

      expect((await entries(me, landlord.id)).map((entry) => entry.id)).not.toContain(unbound.id);
    });
  });

  describe('SC-G4: amending the repayment recalculates the settlement', () => {
    it('keeps the balance at zero and the transaction equal to the new amount', async () => {
      const repayment = await landlordData(true);
      const transactionId = repayment.transactionId!;

      // 還 91：差額 −200，餘額仍 0。
      await request(server())
        .patch(`/api/debt-entries/${repayment.id}`)
        .set(auth(me.token))
        .send({ amount: 9100 })
        .expect(200);
      let list = await entries(me, landlord.id);
      expect(byKind(list, 'SETTLEMENT')).toMatchObject({ delta: -200 });
      expect(await balance(me, landlord.id)).toBe(0);
      expect(await transactionAmount(me, transactionId)).toBe(9100);

      // 還 95 > 欠 93：差額方向反過來（多收 2），餘額仍 0（決策 158）。
      await request(server())
        .patch(`/api/debt-entries/${repayment.id}`)
        .set(auth(me.token))
        .send({ amount: 9500 })
        .expect(200);
      list = await entries(me, landlord.id);
      expect(byKind(list, 'SETTLEMENT')).toMatchObject({ delta: 200 });
      expect(await balance(me, landlord.id)).toBe(0);
      expect(await transactionAmount(me, transactionId)).toBe(9500);

      // 還 93 剛好還清：差額撤銷，之後那筆是一般還款。
      await request(server())
        .patch(`/api/debt-entries/${repayment.id}`)
        .set(auth(me.token))
        .send({ amount: 9300 })
        .expect(200);
      list = await entries(me, landlord.id);
      expect(byKind(list, 'SETTLEMENT')).toBeUndefined();
      expect(byKind(list, 'COLLECT')).toMatchObject({ delta: -9300 });
      expect(await balance(me, landlord.id)).toBe(0);
      expect(await transactionAmount(me, transactionId)).toBe(9300);
    });
  });

  describe('SC-G5: the binding follows a linked pair', () => {
    let alice: Person;
    let bob: Person;
    let aliceSide: string;
    let bobSide: string;

    async function postAlice(body: Record<string, unknown>) {
      return post(alice, { counterparty: { id: aliceSide }, ...body });
    }

    async function incoming(who: Person) {
      return (await proposals(app, who, 'incoming', 'PENDING'))[0]!;
    }

    async function accept(who: Person, proposalId: string, body: Record<string, unknown> = {}) {
      return request(server())
        .post(`/api/debt-proposals/${proposalId}/accept`)
        .set(auth(who.token))
        .send(body);
    }

    beforeEach(async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      ({ aCounterpartyId: aliceSide, bCounterpartyId: bobSide } = await linkPair(app, alice, bob));
    });

    it('binds, withdraws, and recalculates the settlement on the other side too', async () => {
      // Alice 借出 9300，Bob 接受：兩邊都 +/−9300。
      await postAlice({ kind: 'LEND', amount: 9300 }).then((res) => expect(res.status).toBe(201));
      await accept(bob, (await incoming(bob)).id, { record: null }).then((res) =>
        expect(res.status).toBe(200),
      );

      // Alice 記「以此結清」的還款 9000；Bob 接受後他那邊也有綁定的差額。
      await postAlice({ kind: 'REPAYMENT', amount: 9000, settle: true }).then((res) =>
        expect(res.status).toBe(201),
      );
      await accept(bob, (await incoming(bob)).id, { record: null }).then((res) =>
        expect(res.status).toBe(200),
      );

      let aliceList = await entries(alice, aliceSide);
      let bobList = await entries(bob, bobSide);
      const aliceRepayment = byKind(aliceList, 'COLLECT')!;
      const bobRepayment = byKind(bobList, 'REPAY')!;
      expect(byKind(aliceList, 'SETTLEMENT')).toMatchObject({
        delta: -300,
        settlesEntryId: aliceRepayment.id,
      });
      expect(byKind(bobList, 'SETTLEMENT')).toMatchObject({
        delta: 300,
        settlesEntryId: bobRepayment.id,
      });
      expect(await balance(alice, aliceSide)).toBe(0);
      expect(await balance(bob, bobSide)).toBe(0);

      // Alice 撤銷還款；Bob 接受後他那邊的還款與差額都撤銷，兩邊回到欠 9300。
      await request(server())
        .delete(`/api/debt-entries/${aliceRepayment.id}`)
        .set(auth(alice.token))
        .expect(204);
      await accept(bob, (await incoming(bob)).id).then((res) => expect(res.status).toBe(200));

      aliceList = await entries(alice, aliceSide);
      bobList = await entries(bob, bobSide);
      expect(byKind(aliceList, 'SETTLEMENT')).toBeUndefined();
      expect(byKind(aliceList, 'COLLECT')).toBeUndefined();
      expect(byKind(bobList, 'SETTLEMENT')).toBeUndefined();
      expect(byKind(bobList, 'REPAY')).toBeUndefined();
      expect(await balance(alice, aliceSide)).toBe(9300);
      expect(await balance(bob, bobSide)).toBe(-9300);

      // 再記一次「以此結清」，改金額 9100；Bob 接受後他那邊的差額跟著重算成 +200
      //（Bob 欠 9300、還 9100，少 200），兩邊餘額仍舊歸零。
      await postAlice({ kind: 'REPAYMENT', amount: 9000, settle: true }).then((res) =>
        expect(res.status).toBe(201),
      );
      await accept(bob, (await incoming(bob)).id, { record: null }).then((res) =>
        expect(res.status).toBe(200),
      );
      const amended = byKind(await entries(alice, aliceSide), 'COLLECT')!;
      await request(server())
        .patch(`/api/debt-entries/${amended.id}`)
        .set(auth(alice.token))
        .send({ amount: 9100 })
        .expect(200);
      await accept(bob, (await incoming(bob)).id).then((res) => expect(res.status).toBe(200));

      bobList = await entries(bob, bobSide);
      const bobNewRepayment = byKind(bobList, 'REPAY')!;
      expect(byKind(bobList, 'SETTLEMENT')).toMatchObject({
        delta: 200,
        settlesEntryId: bobNewRepayment.id,
      });
      expect(bobNewRepayment.delta).toBe(9100);
      expect(await balance(alice, aliceSide)).toBe(0);
      expect(await balance(bob, bobSide)).toBe(0);
    });
  });
});
