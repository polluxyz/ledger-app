import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CategoriesService } from '../src/categories/categories.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { deferred, holdLock, waitForBlockedQueries } from './concurrency-utils';
import {
  createE2EApp,
  firstAccountId,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/** R7：讓刪除卡在帳戶鎖，再建立引用，驗證刪除重查引用並保留歷史。 */
describe('Account deletion race (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  it('holds the selected account until validation and writing have both finished', async () => {
    const user = await registerAndLogin(app, 'writer@example.com');
    const ledgerId = await firstLedgerId(app, user.token);
    const accountId = await firstAccountId(app, user.token);
    const categories = app.get(CategoriesService);
    const original = categories.findOrCreateByName.bind(categories);
    const validated = deferred();
    const released = deferred();
    // 新分類驗證排在帳戶驗證之後、寫入交易之前；只暫停這一步，其餘都走真正的資料庫。
    const spy = jest.spyOn(categories, 'findOrCreateByName').mockImplementation(async (...args) => {
      const id = await original(...args);
      validated.resolve();
      await released.promise;
      return id;
    });
    const auth = { Authorization: `Bearer ${user.token}` };
    const creation = request(httpServer(app))
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth)
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2026-11-12T00:00:00.000Z',
        accountId,
        newCategoryName: 'Race',
      })
      .then();
    let deletion: Promise<request.Response> | undefined;
    let waiting: Promise<void> | undefined;
    const stopWaiting = new AbortController();
    try {
      await validated.promise;
      deletion = request(httpServer(app)).delete(`/api/accounts/${accountId}`).set(auth).then();
      waiting = waitForBlockedQueries(prisma, 1, stopWaiting.signal);
      await Promise.race([
        waiting,
        deletion.then((response) => {
          throw new Error(
            `Deletion finished before the writer released its account: ${response.status}`,
          );
        }),
      ]);
    } finally {
      stopWaiting.abort();
      await waiting;
      released.resolve();
      await creation;
      if (deletion) await deletion;
      spy.mockRestore();
    }
    expect((await creation).status).toBe(201);
    expect((await deletion).status).toBe(409);
    expect((await deletion).body).toMatchObject({ errorCode: 'ACCOUNT_IN_USE' });
  }, 15000);

  it.each(['accountId', 'toAccountId'] as const)(
    'returns ACCOUNT_IN_USE when a concurrent transfer references %s',
    async (field) => {
      const user = await registerAndLogin(app, 'race@example.com');
      const ledgerId = await firstLedgerId(app, user.token);
      const accountId = await firstAccountId(app, user.token);
      const other = await prisma.account.create({ data: { userId: user.userId, name: 'Bank' } });
      const auth = { Authorization: `Bearer ${user.token}` };
      const lock = await holdLock(
        prisma,
        (tx) => tx.$queryRaw`
        SELECT id FROM "Account" WHERE id = ${accountId} FOR KEY SHARE
      `,
      );
      const deletion = request(httpServer(app))
        .delete(`/api/accounts/${accountId}`)
        .set(auth)
        .then();
      try {
        await waitForBlockedQueries(prisma, 1);
        await request(httpServer(app))
          .post(`/api/ledgers/${ledgerId}/transactions`)
          .set(auth)
          .send({
            type: 'TRANSFER',
            amount: 100,
            date: '2026-11-12T00:00:00.000Z',
            accountId: field === 'accountId' ? accountId : other.id,
            toAccountId: field === 'toAccountId' ? accountId : other.id,
          })
          .expect(201);
      } finally {
        await lock.release();
      }
      const response = await deletion;
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ errorCode: 'ACCOUNT_IN_USE' });
      expect(await prisma.account.findUnique({ where: { id: accountId } })).not.toBeNull();
      expect(await prisma.transaction.count({ where: { ledgerId } })).toBe(1);
    },
    15000,
  );
});
