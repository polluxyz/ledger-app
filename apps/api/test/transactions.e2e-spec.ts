import { INestApplication } from '@nestjs/common';
import { Account, Category, LedgerSummary, Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  firstAccountId,
  firstLedgerId,
  httpServer,
  listAccounts,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 交易的 e2e：分類型別一致性、分頁／日期區間篩選／軟刪除後不可見、viewer 不得
 * 記帳（403），以及 2c 新增的三塊——**帳戶的條件必填**、**餘額確實變動**、
 * **他人帳戶被遮蔽**。對照 spec §3 的 SC-C5～SC-C9。
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

  /** 讀出某帳戶目前的餘額，用來斷言記帳前後的變化。 */
  async function balanceOf(token: string, accountId: string): Promise<number> {
    const accounts = await listAccounts(app, token);
    return accounts.find((account) => account.id === accountId)!.balance;
  }

  it('creates a transaction and rejects a category type mismatch', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const accountId = await firstAccountId(app, alice.token);
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
        accountId,
      });
    expect(created.status).toBe(201);
    const txn = created.body as Transaction;
    expect(txn.category?.id).toBe(expenseCat);
    expect(txn.account).toEqual({ id: accountId, name: '現金' });
    expect(txn.creator.name).toBe('Alice');

    const mismatch = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 50,
        date: '2026-08-08T12:00:00.000Z',
        categoryId: incomeCat,
        accountId,
      });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as { errorCode: string }).errorCode).toBe('CATEGORY_TYPE_MISMATCH');
  });

  // ── 帳戶的條件必填 ───────────────────────────────────────────────────────

  it('requires an account in a tracking ledger and rejects a foreign one (SC-C5)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');
    const bobAccountId = await firstAccountId(app, bob.token);

    const missing = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({ type: 'EXPENSE', amount: 120, date: '2026-08-13T00:00:00.000Z', categoryId: cat });
    expect(missing.status).toBe(400);
    expect((missing.body as { errorCode: string }).errorCode).toBe('ACCOUNT_REQUIRED');

    // 別人的帳戶：404，不洩漏它存在。
    const foreign = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 120,
        date: '2026-08-13T00:00:00.000Z',
        categoryId: cat,
        accountId: bobAccountId,
      });
    expect(foreign.status).toBe(404);
  });

  it('forbids an account in a non-tracking ledger (SC-C6)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const accountId = await firstAccountId(app, alice.token);

    const ledger = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '出遊分帳', tracksBalance: false });
    const ledgerId = (ledger.body as LedgerSummary).id;
    expect((ledger.body as LedgerSummary).tracksBalance).toBe(false);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const withAccount = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 3000,
        date: '2026-08-13T00:00:00.000Z',
        categoryId: cat,
        accountId,
      });
    expect(withAccount.status).toBe(400);
    expect((withAccount.body as { errorCode: string }).errorCode).toBe('ACCOUNT_NOT_ALLOWED');

    // 不帶帳戶則正常建立，且不影響任何餘額。
    const without = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({ type: 'EXPENSE', amount: 3000, date: '2026-08-13T00:00:00.000Z', categoryId: cat });
    expect(without.status).toBe(201);
    expect((without.body as Transaction).account).toBeNull();
    expect(await balanceOf(alice.token, accountId)).toBe(0);
  });

  it('enforces the transfer rules (SC-C7)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cash = await firstAccountId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const bankRes = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '國泰世華' });
    const bank = (bankRes.body as Account).id;

    const base = { type: 'TRANSFER', amount: 1000, date: '2026-08-13T00:00:00.000Z' };

    const sameAccount = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({ ...base, accountId: cash, toAccountId: cash });
    expect(sameAccount.status).toBe(400);
    expect((sameAccount.body as { errorCode: string }).errorCode).toBe('TRANSFER_SAME_ACCOUNT');

    const withCategory = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({ ...base, accountId: cash, toAccountId: bank, categoryId: cat });
    expect(withCategory.status).toBe(400);

    const ok = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({ ...base, accountId: cash, toAccountId: bank });
    expect(ok.status).toBe(201);
    expect((ok.body as Transaction).category).toBeNull();
    expect((ok.body as Transaction).toAccount).toEqual({ id: bank, name: '國泰世華' });
  });

  // ── 餘額 ─────────────────────────────────────────────────────────────────

  it('moves the balance for income, expense and transfer (SC-C8)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cash = await firstAccountId(app, alice.token);
    const expenseCat = await categoryId(alice.token, ledgerId, 'EXPENSE');
    const incomeCat = await categoryId(alice.token, ledgerId, 'INCOME');

    const bankRes = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '國泰世華', initialBalance: 10000 });
    const bank = (bankRes.body as Account).id;

    const post = (body: Record<string, unknown>) =>
      request(server())
        .post(`/api/ledgers/${ledgerId}/transactions`)
        .set(auth(alice.token))
        .send({ date: '2026-08-13T00:00:00.000Z', ...body });

    await post({ type: 'INCOME', amount: 50000, categoryId: incomeCat, accountId: bank });
    await post({ type: 'EXPENSE', amount: 1200, categoryId: expenseCat, accountId: bank });
    await post({ type: 'TRANSFER', amount: 3000, accountId: bank, toAccountId: cash });

    // 10000 + 50000 − 1200 − 3000
    expect(await balanceOf(alice.token, bank)).toBe(55800);
    // 0 + 3000
    expect(await balanceOf(alice.token, cash)).toBe(3000);
  });

  it('drops soft-deleted transactions out of the balance (SC-C8)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const cash = await firstAccountId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 500,
        date: '2026-08-13T00:00:00.000Z',
        categoryId: cat,
        accountId: cash,
      });
    expect(await balanceOf(alice.token, cash)).toBe(-500);

    await request(server())
      .delete(`/api/ledgers/${ledgerId}/transactions/${(created.body as Transaction).id}`)
      .set(auth(alice.token));

    // 刪掉的交易不該繼續扣錢。
    expect(await balanceOf(alice.token, cash)).toBe(0);
  });

  // ── 共享帳本 ─────────────────────────────────────────────────────────────

  it("hides another member's account but keeps the rest (SC-C9)", async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);
    const aliceAccount = await firstAccountId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });

    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 120,
        date: '2026-08-13T00:00:00.000Z',
        categoryId: cat,
        accountId: aliceAccount,
      });

    const asBob = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(bob.token));
    const seen = (asBob.body as Paginated<Transaction>).items[0]!;

    // 協作需要的資訊都在；只有「從哪個戶頭付的」被遮掉。
    expect(seen.account).toBeNull();
    expect(seen.amount).toBe(120);
    expect(seen.category?.id).toBe(cat);
    expect(seen.creator.name).toBe('Alice');
  });

  it("lets an editor amend another member's transaction without owning its account", async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);
    const aliceAccount = await firstAccountId(app, alice.token);
    const cat = await categoryId(alice.token, ledgerId, 'EXPENSE');

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 120,
        date: '2026-08-13T00:00:00.000Z',
        categoryId: cat,
        accountId: aliceAccount,
      });

    const amended = await request(server())
      .patch(`/api/ledgers/${ledgerId}/transactions/${(created.body as Transaction).id}`)
      .set(auth(bob.token))
      .send({ amount: 150 });

    expect(amended.status).toBe(200);
    expect((amended.body as Transaction).amount).toBe(150);
    // 帳戶沒被動到，仍記在 Alice 名下——所以 Bob 看不到它。
    expect((amended.body as Transaction).account).toBeNull();
    expect(await balanceOf(alice.token, aliceAccount)).toBe(-150);
  });

  it('paginates, filters by date range, and hides soft-deleted rows', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const accountId = await firstAccountId(app, alice.token);
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
        .send({ type: 'EXPENSE', amount: (i + 1) * 100, date, categoryId: cat, accountId });
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
    const bobAccountId = await firstAccountId(app, bob.token);

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
        accountId: bobAccountId,
      });
    expect(res.status).toBe(403);
  });
});
