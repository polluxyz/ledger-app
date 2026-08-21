import { INestApplication } from '@nestjs/common';
import { Account, DEFAULT_ACCOUNTS } from '@ledger/shared';
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
 * 帳戶的 e2e：註冊時的預設帳戶、CRUD、名稱唯一、引用中不可刪，以及最重要的
 * 跨使用者隔離——帳戶是使用者範圍的資源，別人的一律當作不存在。
 * 對照 spec §3 的 SC-C1～SC-C4。
 */
describe('Accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('gives a newly registered user the default accounts (SC-C1)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const accounts = await listAccounts(app, alice.token);

    expect(accounts.map((account) => account.name)).toEqual([...DEFAULT_ACCOUNTS]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: '現金', initialBalance: 0, balance: 0 });
  });

  it('creates, renames and deletes an account (SC-C3)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const created = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '國泰世華', initialBalance: 5000 });
    expect(created.status).toBe(201);
    const account = created.body as Account;
    expect(account.balance).toBe(5000);

    const renamed = await request(server())
      .patch(`/api/accounts/${account.id}`)
      .set(auth(alice.token))
      .send({ name: '台灣銀行' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as Account).name).toBe('台灣銀行');

    const deleted = await request(server())
      .delete(`/api/accounts/${account.id}`)
      .set(auth(alice.token));
    expect(deleted.status).toBe(204);
    expect(await listAccounts(app, alice.token)).toHaveLength(1);
  });

  it('refuses to change the initial balance after the account exists', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const created = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '國泰世華', initialBalance: 5000 });
    const account = created.body as Account;

    // 初始餘額是建立當下的歷史事實。DTO 沒有這個欄位，而全域 ValidationPipe 開了
    // forbidNonWhitelisted，所以請求會被退回，而不是把欄位默默丟掉。
    const patched = await request(server())
      .patch(`/api/accounts/${account.id}`)
      .set(auth(alice.token))
      .send({ initialBalance: 999 });
    expect(patched.status).toBe(400);

    // 真的沒被改到。
    const accounts = await listAccounts(app, alice.token);
    expect(accounts.find((item) => item.id === account.id)?.initialBalance).toBe(5000);
  });

  it('accepts a negative initial balance (a credit card already in debt)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const created = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '信用卡', initialBalance: -12000 });

    expect(created.status).toBe(201);
    expect((created.body as Account).balance).toBe(-12000);
  });

  it('rejects a duplicate name for the same user (409)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const duplicate = await request(server())
      .post('/api/accounts')
      .set(auth(alice.token))
      .send({ name: '現金' });

    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { errorCode: string }).errorCode).toBe('ACCOUNT_NAME_TAKEN');
  });

  it('lets two different users each have an account of the same name', async () => {
    // 唯一性只在「同一使用者」內；否則第一個叫「現金」的人就佔走了這個名字。
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');

    const aliceAccounts = await listAccounts(app, alice.token);
    const bobAccounts = await listAccounts(app, bob.token);

    expect(aliceAccounts[0]!.name).toBe('現金');
    expect(bobAccounts[0]!.name).toBe('現金');
    expect(aliceAccounts[0]!.id).not.toBe(bobAccounts[0]!.id);
  });

  it("never exposes another user's account, not even its existence (SC-C2)", async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const bobAccountId = await firstAccountId(app, bob.token);

    // 列表只回自己的。
    const aliceAccounts = await listAccounts(app, alice.token);
    expect(aliceAccounts.map((account) => account.id)).not.toContain(bobAccountId);

    // 直接指名別人的 id：404（而非 403——403 等於承認它存在）。
    const patched = await request(server())
      .patch(`/api/accounts/${bobAccountId}`)
      .set(auth(alice.token))
      .send({ name: '偷改' });
    expect(patched.status).toBe(404);

    const deleted = await request(server())
      .delete(`/api/accounts/${bobAccountId}`)
      .set(auth(alice.token));
    expect(deleted.status).toBe(404);
  });

  it('refuses to delete an account that transactions reference (SC-C4)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const accountId = await firstAccountId(app, alice.token);

    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories?type=EXPENSE`)
      .set(auth(alice.token));
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 120,
        date: '2026-08-13T00:00:00.000Z',
        categoryId,
        accountId,
      });
    expect(created.status).toBe(201);

    const blocked = await request(server())
      .delete(`/api/accounts/${accountId}`)
      .set(auth(alice.token));
    expect(blocked.status).toBe(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe('ACCOUNT_IN_USE');

    // 軟刪除那筆交易之後，帳戶仍然不可刪——歷史必須保持可追溯。
    const txnId = (created.body as { id: string }).id;
    await request(server())
      .delete(`/api/ledgers/${ledgerId}/transactions/${txnId}`)
      .set(auth(alice.token));

    const stillBlocked = await request(server())
      .delete(`/api/accounts/${accountId}`)
      .set(auth(alice.token));
    expect(stillBlocked.status).toBe(409);
  });

  it('requires authentication', async () => {
    const res = await request(server()).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});
