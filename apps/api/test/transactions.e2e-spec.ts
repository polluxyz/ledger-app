import { INestApplication } from '@nestjs/common';
import { Category, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, firstLedgerId, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/**
 * 交易的 e2e：建立並驗證分類型別一致性、分頁／日期區間篩選／軟刪除後不可見、
 * viewer 不得記帳（403）。對照 spec §2 的成功條件逐條驗證。
 */
describe('Transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function categoryId(
    token: string,
    ledgerId: string,
    type: 'EXPENSE' | 'INCOME',
  ): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories?type=${type}`)
      .set(auth(token));
    return (res.body as Category[])[0]!.id;
  }

  it('creates a transaction and rejects a category type mismatch', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const expenseCat = await categoryId(alice.token, ledgerId, 'EXPENSE');
    const incomeCat = await categoryId(alice.token, ledgerId, 'INCOME');

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 120,
        date: '2026-08-08T12:00:00.000Z',
        categoryId: expenseCat,
      });
    expect(created.status).toBe(201);
    const txn = created.body as Transaction;
    expect(txn.category.id).toBe(expenseCat);
    expect(txn.creator.name).toBe('Alice');

    const mismatch = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 50,
        date: '2026-08-08T12:00:00.000Z',
        categoryId: incomeCat,
      });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as { errorCode: string }).errorCode).toBe('CATEGORY_TYPE_MISMATCH');
  });

  it('records a transaction with and without a payment method', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const pms = await request(server())
      .get(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(alice.token));
    const paymentMethod = (pms.body as Array<{ id: string; name: string }>)[0]!;

    const withPm = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 250,
        date: '2026-08-11T12:00:00.000Z',
        categoryId: cat,
        paymentMethodId: paymentMethod.id,
      });
    expect(withPm.status).toBe(201);
    expect((withPm.body as Transaction).paymentMethod).toEqual({
      id: paymentMethod.id,
      name: paymentMethod.name,
    });

    // 省略付款方式時仍可建立，回應為 null（欄位恆存在）。
    const withoutPm = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 60,
        date: '2026-08-11T13:00:00.000Z',
        categoryId: cat,
      });
    expect(withoutPm.status).toBe(201);
    expect((withoutPm.body as Transaction).paymentMethod).toBeNull();
  });

  it('rejects a payment method from another ledger (404)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const bobLedger = await firstLedgerId(app, bob.token);
    const bobPms = await request(server())
      .get(`/api/ledgers/${bobLedger}/payment-methods`)
      .set(auth(bob.token));
    const foreignPmId = (bobPms.body as Array<{ id: string }>)[0]!.id;

    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2026-08-11T12:00:00.000Z',
        categoryId: cat,
        paymentMethodId: foreignPmId,
      });
    expect(res.status).toBe(404);
  });

  it('paginates, filters by date range, and hides soft-deleted rows', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const dates = [
      '2026-08-01T10:00:00.000Z',
      '2026-08-05T10:00:00.000Z',
      '2026-08-10T10:00:00.000Z',
    ];
    for (const [i, date] of dates.entries()) {
      await request(server())
        .post(`/api/ledgers/${ledgerId}/transactions`)
        .set(auth(alice.token))
        .send({ type: 'EXPENSE', amount: (i + 1) * 100, date, categoryId: cat });
    }

    // 第 1 頁、每頁 2 筆，新到舊。
    const page1 = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions?page=1&limit=2`)
      .set(auth(alice.token));
    const paged = page1.body as Paginated<Transaction>;
    expect(paged.total).toBe(3);
    expect(paged.items.map((t) => t.amount)).toEqual([300, 200]);

    // 日期區間篩選。
    const ranged = await request(server())
      .get(
        `/api/ledgers/${ledgerId}/transactions?from=2026-08-04T00:00:00.000Z&to=2026-08-07T00:00:00.000Z`,
      )
      .set(auth(alice.token));
    expect((ranged.body as Paginated<Transaction>).total).toBe(1);

    // 軟刪除最新一筆，接著確認它從列表與明細都消失。
    const newestId = paged.items[0]!.id;
    const del = await request(server())
      .delete(`/api/ledgers/${ledgerId}/transactions/${newestId}`)
      .set(auth(alice.token));
    expect(del.status).toBe(204);

    const afterDelete = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token));
    expect((afterDelete.body as Paginated<Transaction>).total).toBe(2);

    const detail = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions/${newestId}`)
      .set(auth(alice.token));
    expect(detail.status).toBe(404);
  });

  it('forbids a viewer from recording a transaction (403)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });

    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(bob.token))
      .send({
        type: 'EXPENSE',
        amount: 10,
        date: '2026-08-08T12:00:00.000Z',
        categoryId: cat,
      });
    expect(res.status).toBe(403);
  });
});
