import { INestApplication } from '@nestjs/common';
import type { Account, Debt, DebtSummary, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  firstAccountId,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 單邊借還（3b-1）的端對端流程：借出與借入對餘額的影響、分次還款與結清、舊債、免除、
 * 刪除、交易端點的唯讀、帳本不能真刪、每人淨額。對應 spec SC-D1～SC-D9、SC-D11。
 *
 * ⚠️ 協調者先寫的驗收門檻，worker 不准修改。
 *
 * 每個測試用註冊時自動建立的個人帳本（連動帳本）與預設的「現金」帳戶。餘額一律從
 * `GET /accounts` 讀出來比對，驗的是使用者實際看到的數字。
 */
describe('Debts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const DAY = '2026-09-24T12:00:00.000Z';

  interface Me {
    token: string;
    ledgerId: string;
    cashId: string;
  }

  async function me(): Promise<Me> {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    return {
      token: alice.token,
      ledgerId: await firstLedgerId(app, alice.token),
      cashId: await firstAccountId(app, alice.token),
    };
  }

  async function cashBalance(user: Me): Promise<number> {
    const res = await request(server()).get('/api/accounts').set(auth(user.token));
    return (res.body as Account[]).find((account) => account.id === user.cashId)!.balance;
  }

  async function ledgerTransactions(user: Me): Promise<Transaction[]> {
    const res = await request(server())
      .get(`/api/ledgers/${user.ledgerId}/transactions`)
      .set(auth(user.token));
    expect(res.status).toBe(200);
    return (res.body as Paginated<Transaction>).items;
  }

  function createDebt(user: Me, body: Record<string, unknown>) {
    return request(server()).post('/api/debts').set(auth(user.token)).send(body);
  }

  async function lend(user: Me, principal: number, recorded = true): Promise<Debt> {
    const res = await createDebt(user, {
      direction: 'LENT',
      counterpartyName: '小明',
      principal,
      date: DAY,
      ...(recorded ? { record: { ledgerId: user.ledgerId, accountId: user.cashId } } : {}),
    });
    expect(res.status).toBe(201);
    return res.body as Debt;
  }

  async function borrow(user: Me, principal: number): Promise<Debt> {
    const res = await createDebt(user, {
      direction: 'BORROWED',
      counterpartyName: '小華',
      principal,
      date: DAY,
      record: { ledgerId: user.ledgerId, accountId: user.cashId },
    });
    expect(res.status).toBe(201);
    return res.body as Debt;
  }

  function pay(user: Me, debtId: string, amount: number, extra: Record<string, unknown> = {}) {
    return request(server())
      .post(`/api/debts/${debtId}/payments`)
      .set(auth(user.token))
      .send({ amount, date: DAY, ...extra });
  }

  function errorCode(res: request.Response): string {
    return (res.body as { errorCode: string }).errorCode;
  }

  // SC-D1
  it('lending takes the money out of the account as a LEND transaction with no category', async () => {
    const user = await me();
    const before = await cashBalance(user);

    const debt = await lend(user, 5000);
    expect(debt).toMatchObject({ outstanding: 5000, status: 'OPEN', direction: 'LENT' });
    expect(await cashBalance(user)).toBe(before - 5000);

    const [txn] = await ledgerTransactions(user);
    expect(txn).toMatchObject({ type: 'LEND', amount: 5000, category: null, debtId: debt.id });
    expect(debt.transactionId).toBe(txn!.id);
  });

  // SC-D2（其餘方向由 SC-D3、SC-D4 一起涵蓋）
  it('borrowing puts the money into the account', async () => {
    const user = await me();
    const before = await cashBalance(user);
    await borrow(user, 3000);
    expect(await cashBalance(user)).toBe(before + 3000);
  });

  // SC-D3、SC-D4
  describe('repayments', () => {
    it('settles after repayments add up, as COLLECT for money lent', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const afterLend = await cashBalance(user);

      const first = await pay(user, debt.id, 2000);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ outstanding: 3000, status: 'OPEN' });

      const second = await pay(user, debt.id, 3000);
      expect(second.body).toMatchObject({ outstanding: 0, status: 'SETTLED' });
      expect(await cashBalance(user)).toBe(afterLend + 5000);

      const collects = (await ledgerTransactions(user)).filter((t) => t.type === 'COLLECT');
      expect(collects).toHaveLength(2);
      expect(collects.every((t) => t.debtId === debt.id)).toBe(true);

      const more = await pay(user, debt.id, 1);
      expect(more.status).toBe(409);
      expect(errorCode(more)).toBe('DEBT_NOT_OPEN');
    });

    it('records a repayment of money borrowed as REPAY, taking money out', async () => {
      const user = await me();
      const debt = await borrow(user, 3000);
      const before = await cashBalance(user);

      await pay(user, debt.id, 1000).expect(201);
      expect(await cashBalance(user)).toBe(before - 1000);
      expect((await ledgerTransactions(user)).some((t) => t.type === 'REPAY')).toBe(true);
    });

    it('rejects a repayment larger than what is still owed', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const res = await pay(user, debt.id, 5001);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('DEBT_OVERPAYMENT');
    });

    it('does not let the caller choose the transaction type', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const res = await pay(user, debt.id, 100, { type: 'REPAY' });
      expect(res.status).toBe(400);
    });

    it('reuses the principal transaction’s ledger and account by default', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const res = await pay(user, debt.id, 500);
      const payment = (res.body as Debt).payments[0]!;
      expect(payment.transactionId).not.toBeNull();

      const txn = (await ledgerTransactions(user)).find((t) => t.id === payment.transactionId);
      expect(txn).toMatchObject({ type: 'COLLECT', account: { id: user.cashId } });
    });

    it('deleting a repayment reopens a settled debt and reverses its balance effect', async () => {
      const user = await me();
      const debt = await lend(user, 1000);
      const settled = (await pay(user, debt.id, 1000)).body as Debt;
      const afterPay = await cashBalance(user);

      await request(server())
        .delete(`/api/debts/${debt.id}/payments/${settled.payments[0]!.id}`)
        .set(auth(user.token))
        .expect(204);

      const reopened = await request(server()).get(`/api/debts/${debt.id}`).set(auth(user.token));
      expect(reopened.body).toMatchObject({ outstanding: 1000, status: 'OPEN', payments: [] });
      expect(await cashBalance(user)).toBe(afterPay - 1000);
    });
  });

  // SC-D5
  it('an old debt recorded without a transaction leaves balances alone', async () => {
    const user = await me();
    const before = await cashBalance(user);

    const debt = await lend(user, 2000, false);
    expect(debt).toMatchObject({ transactionId: null, outstanding: 2000, status: 'OPEN' });

    const paid = (await pay(user, debt.id, 500)).body as Debt;
    expect(paid.outstanding).toBe(1500);
    expect(paid.payments[0]!.transactionId).toBeNull();

    expect(await cashBalance(user)).toBe(before);
    expect(await ledgerTransactions(user)).toEqual([]);
  });

  // SC-D6
  describe('forgiving', () => {
    it('marks the debt FORGIVEN without creating a transaction', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      await pay(user, debt.id, 1000).expect(201);
      const balance = await cashBalance(user);
      const transactionCount = (await ledgerTransactions(user)).length;

      const res = await request(server())
        .post(`/api/debts/${debt.id}/forgive`)
        .set(auth(user.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'FORGIVEN' });
      expect((res.body as Debt).forgivenAt).not.toBeNull();

      expect(await cashBalance(user)).toBe(balance);
      expect(await ledgerTransactions(user)).toHaveLength(transactionCount);

      const after = await pay(user, debt.id, 1);
      expect(errorCode(after)).toBe('DEBT_NOT_OPEN');
    });

    it('cannot forgive money you borrowed', async () => {
      const user = await me();
      const debt = await borrow(user, 3000);
      const res = await request(server())
        .post(`/api/debts/${debt.id}/forgive`)
        .set(auth(user.token));
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('DEBT_NOT_FORGIVABLE');
    });
  });

  // SC-D7
  it('deleting a debt removes it and all its transactions from the balance', async () => {
    const user = await me();
    const before = await cashBalance(user);
    const debt = await lend(user, 5000);
    await pay(user, debt.id, 2000).expect(201);

    await request(server()).delete(`/api/debts/${debt.id}`).set(auth(user.token)).expect(204);

    expect(await cashBalance(user)).toBe(before);
    expect(await ledgerTransactions(user)).toEqual([]);
    await request(server()).get(`/api/debts/${debt.id}`).set(auth(user.token)).expect(404);
    const list = await request(server()).get('/api/debts').set(auth(user.token));
    expect((list.body as Paginated<Debt>).items).toEqual([]);
  });

  describe('editing', () => {
    it('changing the principal moves the principal transaction and the balance with it', async () => {
      const user = await me();
      const before = await cashBalance(user);
      const debt = await lend(user, 5000);

      const res = await request(server())
        .patch(`/api/debts/${debt.id}`)
        .set(auth(user.token))
        .send({ principal: 4000, note: '改了' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ principal: 4000, outstanding: 4000, note: '改了' });
      expect(await cashBalance(user)).toBe(before - 4000);
    });

    it('refuses a principal below what has already been repaid', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      await pay(user, debt.id, 3000).expect(201);

      const res = await request(server())
        .patch(`/api/debts/${debt.id}`)
        .set(auth(user.token))
        .send({ principal: 2999 });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('DEBT_OVERPAYMENT');
    });
  });

  // SC-D8
  describe('the transaction endpoints treat debt transactions as read-only', () => {
    it('cannot create a debt-type transaction directly', async () => {
      const user = await me();
      const res = await request(server())
        .post(`/api/ledgers/${user.ledgerId}/transactions`)
        .set(auth(user.token))
        .send({ type: 'LEND', amount: 100, date: DAY, accountId: user.cashId });
      expect(res.status).toBe(400);
    });

    it('cannot turn an ordinary transaction into a debt type', async () => {
      const user = await me();
      const categories = await request(server())
        .get(`/api/ledgers/${user.ledgerId}/categories`)
        .query({ type: 'EXPENSE' })
        .set(auth(user.token));
      const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;
      const created = await request(server())
        .post(`/api/ledgers/${user.ledgerId}/transactions`)
        .set(auth(user.token))
        .send({ type: 'EXPENSE', amount: 100, date: DAY, accountId: user.cashId, categoryId });
      expect(created.status).toBe(201);

      const res = await request(server())
        .patch(`/api/ledgers/${user.ledgerId}/transactions/${(created.body as Transaction).id}`)
        .set(auth(user.token))
        .send({ type: 'COLLECT' });
      expect(res.status).toBe(400);
    });

    it('cannot edit or delete a debt transaction', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const path = `/api/ledgers/${user.ledgerId}/transactions/${debt.transactionId!}`;

      const patched = await request(server()).patch(path).set(auth(user.token)).send({ amount: 1 });
      expect(patched.status).toBe(409);
      expect(errorCode(patched)).toBe('DEBT_TRANSACTION_READ_ONLY');

      const deleted = await request(server()).delete(path).set(auth(user.token));
      expect(deleted.status).toBe(409);
      expect(errorCode(deleted)).toBe('DEBT_TRANSACTION_READ_ONLY');
    });
  });

  // SC-D9
  it('a ledger holding debt transactions can be archived but not deleted', async () => {
    const user = await me();
    await lend(user, 5000);
    const ledger = await request(server())
      .get(`/api/ledgers/${user.ledgerId}`)
      .set(auth(user.token));
    const name = (ledger.body as { name: string }).name;

    const res = await request(server())
      .delete(`/api/ledgers/${user.ledgerId}`)
      .query({ confirm: name })
      .set(auth(user.token));
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('LEDGER_HAS_DEBT_TRANSACTIONS');

    await request(server())
      .post(`/api/ledgers/${user.ledgerId}/archive`)
      .set(auth(user.token))
      .expect(201);
  });

  // SC-D11
  it('summarises the net per person from open debts only', async () => {
    const user = await me();
    const named = (name: string, direction: 'LENT' | 'BORROWED', principal: number) =>
      createDebt(user, { direction, counterpartyName: name, principal, date: DAY }).expect(201);

    await named('小明', 'LENT', 1000);
    await named('小明', 'BORROWED', 300);
    await named('小華', 'LENT', 500);
    // 已結清與已免除的不計入。
    const settled = (await named('阿強', 'LENT', 100)).body as Debt;
    await pay(user, settled.id, 100).expect(201);
    const forgiven = (await named('阿美', 'LENT', 100)).body as Debt;
    await request(server()).post(`/api/debts/${forgiven.id}/forgive`).set(auth(user.token));

    const res = await request(server()).get('/api/debts/summary').set(auth(user.token));
    expect(res.status).toBe(200);
    const items = [...(res.body as DebtSummary).items].sort((a, b) =>
      a.counterpartyName.localeCompare(b.counterpartyName),
    );
    expect(items).toEqual(
      [
        { counterpartyName: '小明', counterpartyUserId: null, net: 700 },
        { counterpartyName: '小華', counterpartyUserId: null, net: 500 },
      ].sort((a, b) => a.counterpartyName.localeCompare(b.counterpartyName)),
    );
  });

  it('lists debts newest first and filters by status', async () => {
    const user = await me();
    const older = await createDebt(user, {
      direction: 'LENT',
      counterpartyName: 'A',
      principal: 100,
      date: '2026-09-01T00:00:00.000Z',
    });
    const newer = await createDebt(user, {
      direction: 'LENT',
      counterpartyName: 'B',
      principal: 100,
      date: '2026-09-20T00:00:00.000Z',
    });
    await pay(user, (older.body as Debt).id, 100).expect(201);

    const all = await request(server()).get('/api/debts').set(auth(user.token));
    expect((all.body as Paginated<Debt>).items.map((d) => d.counterpartyName)).toEqual(['B', 'A']);

    const open = await request(server())
      .get('/api/debts')
      .query({ status: 'OPEN' })
      .set(auth(user.token));
    expect((open.body as Paginated<Debt>).items.map((d) => d.id)).toEqual([
      (newer.body as Debt).id,
    ]);
  });
  // SC-D23～SC-D30：以此結清（決策 30）與明確不產生交易的還款。
  describe('settling with a difference', () => {
    function debtOf(user: Me, debtId: string) {
      return request(server()).get(`/api/debts/${debtId}`).set(auth(user.token));
    }

    // SC-D23
    it('settles a lent debt short of the principal and reports the shortfall', async () => {
      const user = await me();
      const debt = await lend(user, 93);
      const afterLend = await cashBalance(user);

      const res = await pay(user, debt.id, 90, { settles: true });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'SETTLED',
        outstanding: 0,
        settlementDifference: -3,
      });
      expect((res.body as Debt).payments).toEqual([
        expect.objectContaining({ amount: 90, settles: true }),
      ]);
      // 帳戶照實際收到的 90 變動，差額不另外產生交易。
      expect(await cashBalance(user)).toBe(afterLend + 90);
      const collects = (await ledgerTransactions(user)).filter((txn) => txn.type === 'COLLECT');
      expect(collects).toEqual([expect.objectContaining({ amount: 90 })]);
    });

    // SC-D24
    it('lets a settling payment exceed what is owed, but not a plain one', async () => {
      const user = await me();
      const debt = await lend(user, 93);
      const afterLend = await cashBalance(user);

      const plain = await pay(user, debt.id, 95);
      expect(plain.status).toBe(409);
      expect(errorCode(plain)).toBe('DEBT_OVERPAYMENT');

      const settling = await pay(user, debt.id, 95, { settles: true });
      expect(settling.body).toMatchObject({ status: 'SETTLED', settlementDifference: 2 });
      expect(await cashBalance(user)).toBe(afterLend + 95);
    });

    // SC-D25
    it('flips the sign for money borrowed: paying less is in my favour', async () => {
      const user = await me();
      const debt = await borrow(user, 93);
      const afterBorrow = await cashBalance(user);

      const res = await pay(user, debt.id, 90, { settles: true });
      expect(res.body).toMatchObject({ status: 'SETTLED', settlementDifference: 3 });
      expect(await cashBalance(user)).toBe(afterBorrow - 90);
      expect((await ledgerTransactions(user)).map((txn) => txn.type)).toContain('REPAY');
    });

    // SC-D26
    it('reopens the debt when the settling payment is deleted, with its transaction', async () => {
      const user = await me();
      const debt = await lend(user, 93);
      const afterLend = await cashBalance(user);
      const settled = (await pay(user, debt.id, 90, { settles: true })).body as Debt;

      const removed = await request(server())
        .delete(`/api/debts/${debt.id}/payments/${settled.payments[0]!.id}`)
        .set(auth(user.token));
      expect(removed.status).toBe(204);

      expect((await debtOf(user, debt.id)).body).toMatchObject({
        status: 'OPEN',
        outstanding: 93,
        settlementDifference: null,
      });
      expect(await cashBalance(user)).toBe(afterLend);
    });

    // SC-D27
    it('refuses a new principal once settled with a difference, but keeps notes editable', async () => {
      const user = await me();
      const debt = await lend(user, 93);
      await pay(user, debt.id, 90, { settles: true });

      const principal = await request(server())
        .patch(`/api/debts/${debt.id}`)
        .set(auth(user.token))
        .send({ principal: 100 });
      expect(principal.status).toBe(409);
      expect(errorCode(principal)).toBe('DEBT_NOT_OPEN');
      expect((await debtOf(user, debt.id)).body).toMatchObject({ principal: 93 });

      const note = await request(server())
        .patch(`/api/debts/${debt.id}`)
        .set(auth(user.token))
        .send({ note: '少 3 塊算了' });
      expect(note.status).toBe(200);
    });

    // SC-D28
    it('refuses any further payment once settled, and the database backs it up', async () => {
      const user = await me();
      const debt = await lend(user, 93);
      await pay(user, debt.id, 90, { settles: true });

      for (const extra of [{ settles: true }, {}]) {
        const res = await pay(user, debt.id, 1, extra);
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('DEBT_NOT_OPEN');
      }

      // 繞過 service 直接寫第二筆未刪除的結清還款，部分唯一索引要擋下來。
      await expect(
        prisma.debtPayment.create({
          data: { debtId: debt.id, amount: 1, date: new Date(DAY), settles: true },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    // SC-D29
    it('reports a zero difference for an exact settling payment and drops it from the summary', async () => {
      const user = await me();
      const debt = await lend(user, 93);

      const res = await pay(user, debt.id, 93, { settles: true });
      expect(res.body).toMatchObject({ status: 'SETTLED', settlementDifference: 0 });

      const summary = await request(server()).get('/api/debts/summary').set(auth(user.token));
      expect((summary.body as DebtSummary).items).toEqual([]);
    });

    // SC-D30
    it('records no transaction when record is null, even though the principal has one', async () => {
      const user = await me();
      const debt = await lend(user, 5000);
      const afterLend = await cashBalance(user);

      const res = await pay(user, debt.id, 2000, { record: null });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ outstanding: 3000 });
      expect((res.body as Debt).payments[0]).toMatchObject({ transactionId: null });
      expect(await cashBalance(user)).toBe(afterLend);

      // 省略 record 則照舊沿用本金交易。
      await pay(user, debt.id, 1000);
      expect(await cashBalance(user)).toBe(afterLend + 1000);
    });
  });
});
