/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import type { LedgerPerson, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  firstLedgerId,
  httpServer,
  listAccounts,
  resetDb,
} from './e2e-utils';
import { auth, createCounterparty, person, type Person } from './linking-utils';

/** 共享帳本交易的付款人、份額、帳戶與唯讀規則（3e SC-E2～E15）。 */
describe('Ledger split transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const date = '2026-10-04T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function scene() {
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
    const people = await prisma.ledgerPerson.findMany({ where: { ledgerId } });
    const ids = [me, ming, hua].map((member) => people.find((p) => p.userId === member.userId)!.id);
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(me.token))
      .expect(200);
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;
    return { me, ming, hua, ledgerId, ids, categoryId };
  }

  async function balance(who: Person): Promise<number> {
    const accounts = await listAccounts(app, who.token);
    return accounts.find((account) => account.id === who.cashId)!.balance;
  }

  function create(s: Awaited<ReturnType<typeof scene>>, body: Record<string, unknown>) {
    return request(server())
      .post(`/api/ledgers/${s.ledgerId}/transactions`)
      .set(auth(s.me.token))
      .send({ type: 'EXPENSE', amount: 150000, date, categoryId: s.categoryId, ...body });
  }

  function patch(s: Awaited<ReturnType<typeof scene>>, id: string, body: Record<string, unknown>) {
    return request(server())
      .patch(`/api/ledgers/${s.ledgerId}/transactions/${id}`)
      .set(auth(s.me.token))
      .send(body);
  }

  const equal = (ids: string[]) => ({
    method: 'EQUAL',
    shares: ids.map((personId) => ({ personId })),
  });

  it('SC-E2：預設付款人是記帳者，住宿三人均分並扣他的帳戶', async () => {
    const s = await scene();
    const before = await balance(s.me);
    const response = await create(s, {
      amount: 600000,
      accountId: s.me.cashId,
      ledgerSplit: equal(s.ids),
    }).expect(201);
    const transaction = response.body as Transaction;
    expect(transaction.payer?.id).toBe(s.ids[0]);
    expect(transaction.ledgerSplit?.shares.map((share) => share.share)).toEqual([
      200000, 200000, 200000,
    ]);
    expect(
      (await prisma.transaction.findUnique({ where: { id: transaction.id } }))?.payerPersonId,
    ).toBe(s.ids[0]);
    expect(await balance(s.me)).toBe(before - 600000);
    const auto = (await create(s, { amount: 300000, accountId: s.me.cashId }).expect(201))
      .body as Transaction;
    expect(auto.ledgerSplit?.shares.map((share) => share.share)).toEqual([100000, 100000, 100000]);
  });

  it('SC-E3、E7、E8：別人付款待補，改付款人需選帳戶，關閉名單', async () => {
    const s = await scene();
    const mine = await balance(s.me);
    const mings = await balance(s.ming);
    const transaction = (
      await create(s, { payerPersonId: s.ids[1], ledgerSplit: equal(s.ids) }).expect(201)
    ).body as Transaction;
    expect(transaction.account).toBeNull();
    expect(await balance(s.me)).toBe(mine);
    expect(await balance(s.ming)).toBe(mings);
    const url = `/api/ledgers/${s.ledgerId}/transactions/${transaction.id}`;
    const read = async (who: Person) =>
      (await request(server()).get(url).set(auth(who.token)).expect(200)).body as Transaction;
    expect((await read(s.ming)).accountPending).toBe(true);
    expect((await read(s.me)).accountPending).toBe(false);
    expect((await read(s.hua)).accountPending).toBe(false);
    await request(server())
      .put(`${url}/account`)
      .set(auth(s.ming.token))
      .send({ accountId: s.ming.cashId })
      .expect(200);
    expect(await balance(s.ming)).toBe(mings - 150000);
    expect((await read(s.ming)).accountPending).toBe(false);
    expect(
      (await patch(s, transaction.id, { payerPersonId: s.ids[0] }).expect(400)).body.errorCode,
    ).toBe('ACCOUNT_REQUIRED');
    await patch(s, transaction.id, { payerPersonId: s.ids[0], accountId: s.me.cashId }).expect(200);
    expect(await balance(s.me)).toBe(mine - 150000);
    expect(await balance(s.ming)).toBe(mings);
    const removed = (await patch(s, transaction.id, { ledgerSplit: null }).expect(200))
      .body as Transaction;
    expect(removed.ledgerSplit).toBeNull();
    expect(
      await prisma.ledgerSplit.findUnique({ where: { transactionId: transaction.id } }),
    ).toBeNull();
  });

  it('SC-E11 舊資料與付款人列表篩選', async () => {
    const s = await scene();
    const old = await prisma.transaction.create({
      data: {
        ledgerId: s.ledgerId,
        creatorId: s.me.userId,
        type: 'EXPENSE',
        amount: 10000,
        date: new Date(date),
        categoryId: s.categoryId,
        accountId: s.me.cashId,
      },
    });
    await create(s, { payerPersonId: s.ids[1] }).expect(201);
    const detail = (
      await request(server())
        .get(`/api/ledgers/${s.ledgerId}/transactions/${old.id}`)
        .set(auth(s.me.token))
        .expect(200)
    ).body as Transaction;
    expect(detail.payer?.id).toBe(s.ids[0]);
    expect(detail.ledgerSplit).toBeNull();
    const list = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions`)
      .query({ payerPersonId: s.ids[0] })
      .set(auth(s.me.token))
      .expect(200);
    expect((list.body as { items: Transaction[] }).items.map((item) => item.id)).toEqual([old.id]);
    expect((list.body as { total: number }).total).toBe(1);
    const empty = await request(server())
      .get(`/api/ledgers/${s.ledgerId}/transactions`)
      .query({ payerPersonId: s.ids[2] })
      .set(auth(s.me.token))
      .expect(200);
    expect(empty.body as { items: Transaction[]; total: number }).toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('自訂金額改總額要重新驗證，轉帳會清掉付款人與名單', async () => {
    const s = await scene();
    const transaction = (
      await create(s, {
        accountId: s.me.cashId,
        ledgerSplit: {
          method: 'AMOUNT',
          shares: [
            { personId: s.ids[0], amount: 100000 },
            { personId: s.ids[1], amount: 50000 },
          ],
        },
      }).expect(201)
    ).body as Transaction;
    expect((await patch(s, transaction.id, { amount: 180000 }).expect(400)).body.errorCode).toBe(
      'SPLIT_SUM_MISMATCH',
    );
    const secondAccount = await prisma.account.create({
      data: { userId: s.me.userId, name: '銀行' },
    });
    const transfer = (
      await patch(s, transaction.id, { type: 'TRANSFER', toAccountId: secondAccount.id }).expect(
        200,
      )
    ).body as Transaction;
    expect(transfer.payer).toBeNull();
    expect(transfer.ledgerSplit).toBeNull();
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(stored.payerPersonId).toBeNull();
    expect(
      await prisma.ledgerSplit.findUnique({ where: { transactionId: transaction.id } }),
    ).toBeNull();
  });

  it('SC-E12、E13：不適用的名單拒絕，結清交易唯讀', async () => {
    const s = await scene();
    const personalId = await firstLedgerId(app, s.me.token);
    const personalCategory = (
      await request(server())
        .get(`/api/ledgers/${personalId}/categories`)
        .query({ type: 'EXPENSE' })
        .set(auth(s.me.token))
        .expect(200)
    ).body[0].id as string;
    const personal = await request(server())
      .post(`/api/ledgers/${personalId}/transactions`)
      .set(auth(s.me.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date,
        categoryId: personalCategory,
        accountId: s.me.cashId,
        payerPersonId: s.ids[0],
      })
      .expect(400);
    expect(personal.body.errorCode).toBe('LEDGER_SPLIT_NOT_ALLOWED');
    const transfer = await create(s, {
      type: 'TRANSFER',
      categoryId: undefined,
      accountId: s.me.cashId,
      toAccountId: s.me.cashId,
      ledgerSplit: equal(s.ids),
    }).expect(400);
    expect(transfer.body.errorCode).toBe('LEDGER_SPLIT_NOT_ALLOWED');
    const settlementTransaction = await prisma.transaction.create({
      data: {
        ledgerId: s.ledgerId,
        creatorId: s.me.userId,
        type: 'TRANSFER',
        amount: 10000,
        date: new Date(date),
        accountId: s.me.cashId,
      },
    });
    await prisma.ledgerSettlement.create({
      data: {
        transactionId: settlementTransaction.id,
        fromPersonId: s.ids[0]!,
        toPersonId: s.ids[1]!,
      },
    });
    expect(
      (await patch(s, settlementTransaction.id, { amount: 20000 }).expect(409)).body.errorCode,
    ).toBe('SETTLEMENT_TRANSACTION_READ_ONLY');
    expect(
      (
        await request(server())
          .delete(`/api/ledgers/${s.ledgerId}/transactions/${settlementTransaction.id}`)
          .set(auth(s.me.token))
          .expect(409)
      ).body.errorCode,
    ).toBe('SETTLEMENT_TRANSACTION_READ_ONLY');

    const friend = await createCounterparty(app, s.me, '朋友');
    const split = await request(server())
      .post('/api/splits')
      .set(auth(s.me.token))
      .send({
        type: 'EXPENSE',
        ledgerId: s.ledgerId,
        categoryId: s.categoryId,
        total: 10000,
        date,
        payer: null,
        accountId: s.me.cashId,
        method: 'EQUAL',
        participants: [{ counterpartyId: null }, { counterpartyId: friend.id }],
      })
      .expect(201);
    const splitTx = await prisma.transaction.findFirstOrThrow({
      where: { splitId: split.body.id as string, type: 'EXPENSE' },
    });
    expect(
      (await patch(s, splitTx.id, { ledgerSplit: equal(s.ids) }).expect(400)).body.errorCode,
    ).toBe('LEDGER_SPLIT_NOT_ALLOWED');
    expect((await patch(s, splitTx.id, { amount: 20000 }).expect(409)).body.errorCode).toBe(
      'SPLIT_TRANSACTION_READ_ONLY',
    );

    const debt = await request(server())
      .post('/api/debt-entries')
      .set(auth(s.me.token))
      .send({
        counterparty: { id: friend.id },
        kind: 'LEND',
        amount: 10000,
        date,
        record: { ledgerId: s.ledgerId, accountId: s.me.cashId },
      })
      .expect(201);
    const debtTx = await prisma.transaction.findFirstOrThrow({
      where: { debtEntry: { id: debt.body.entries[0].id as string } },
    });
    expect(
      (await patch(s, debtTx.id, { ledgerSplit: equal(s.ids) }).expect(400)).body.errorCode,
    ).toBe('LEDGER_SPLIT_NOT_ALLOWED');
    expect((await patch(s, debtTx.id, { amount: 20000 }).expect(409)).body.errorCode).toBe(
      'DEBT_TRANSACTION_READ_ONLY',
    );
  });

  it('改付款人時舊帳戶一律清空，非成員也不能留帳戶', async () => {
    const s = await scene();
    const guest = await prisma.ledgerPerson.create({
      data: { ledgerId: s.ledgerId, name: '阿美' },
    });
    const transaction = (await create(s, { accountId: s.me.cashId }).expect(201))
      .body as Transaction;
    expect(
      (await patch(s, transaction.id, { payerPersonId: s.ids[1] }).expect(200)).body.account,
    ).toBeNull();
    await request(server())
      .put(`/api/ledgers/${s.ledgerId}/transactions/${transaction.id}/account`)
      .set(auth(s.ming.token))
      .send({ accountId: s.ming.cashId })
      .expect(200);
    const guestPaid = (await patch(s, transaction.id, { payerPersonId: guest.id }).expect(200))
      .body as Transaction;
    expect(guestPaid.account).toBeNull();
    expect(
      (await prisma.transaction.findUnique({ where: { id: transaction.id } }))?.accountId,
    ).toBeNull();
  });

  it('SC-E14、E15：離開者保留於既有名單，錯誤份額不寫入', async () => {
    const s = await scene();
    const transaction = (
      await create(s, { payerPersonId: s.ids[1], ledgerSplit: equal(s.ids) }).expect(201)
    ).body as Transaction;
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: s.ledgerId, userId: s.ming.userId } },
    });
    expect((await create(s, { payerPersonId: s.ids[1] }).expect(400)).body.errorCode).toBe(
      'LEDGER_PERSON_NOT_SELECTABLE',
    );
    expect(
      (await create(s, { accountId: s.me.cashId, ledgerSplit: equal(s.ids) }).expect(400)).body
        .errorCode,
    ).toBe('LEDGER_PERSON_NOT_SELECTABLE');
    const changed = (await patch(s, transaction.id, { amount: 180000 }).expect(200))
      .body as Transaction;
    expect(changed.ledgerSplit?.shares.map((share) => share.share)).toEqual([60000, 60000, 60000]);
    expect(changed.ledgerSplit?.shares[1]?.person.status).toBe('LEFT');
    const before = await prisma.transaction.count();
    const cases = [
      [{ method: 'AMOUNT', shares: [{ personId: s.ids[0], amount: 1 }] }, 'SPLIT_SUM_MISMATCH'],
      [{ method: 'RATIO', shares: [{ personId: s.ids[0], ratio: 9999 }] }, 'SPLIT_SUM_MISMATCH'],
      [
        {
          method: 'AMOUNT',
          shares: [
            { personId: s.ids[0], amount: 0 },
            { personId: s.ids[2], amount: 150000 },
          ],
        },
        'SPLIT_SHARE_NOT_POSITIVE',
      ],
    ] as const;
    for (const [ledgerSplit, code] of cases) {
      expect(
        (await create(s, { accountId: s.me.cashId, ledgerSplit }).expect(400)).body.errorCode,
      ).toBe(code);
    }
    expect(await prisma.transaction.count()).toBe(before);
  });

  it('非成員付款沒有帳戶待補，也不能替他選帳戶', async () => {
    const s = await scene();
    const guest = await prisma.ledgerPerson.create({
      data: { ledgerId: s.ledgerId, name: '阿美' },
    });
    const transaction = (
      await create(s, {
        payerPersonId: guest.id,
        ledgerSplit: equal([s.ids[0]!, guest.id]),
      }).expect(201)
    ).body as Transaction;
    expect(transaction.accountPending).toBe(false);
    expect(transaction.payer).toMatchObject({
      name: '阿美',
      status: 'GUEST',
    } satisfies Partial<LedgerPerson>);
    expect(
      (await create(s, { payerPersonId: guest.id, accountId: s.me.cashId }).expect(400)).body
        .errorCode,
    ).toBe('ACCOUNT_NOT_PAYERS');
    expect(
      (
        await request(server())
          .put(`/api/ledgers/${s.ledgerId}/transactions/${transaction.id}/account`)
          .set(auth(s.me.token))
          .send({ accountId: s.me.cashId })
          .expect(400)
      ).body.errorCode,
    ).toBe('ACCOUNT_NOT_PAYERS');
  });
});
