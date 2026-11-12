import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { holdLock, waitForBlockedQueries } from './concurrency-utils';
import {
  createE2EApp,
  createSharedLedger,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/** R14：鎖住目標使用者，讓兩個新增都通過前置檢查，再觸發真實唯一鍵衝突。 */
describe('Member addition race (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  it('returns ALREADY_MEMBER for a concurrent duplicate addition', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com');
    const bob = await registerAndLogin(app, 'bob@example.com');
    const ledgerId = await createSharedLedger(app, alice.token);
    const lock = await holdLock(
      prisma,
      (tx) => tx.$queryRaw`
      SELECT id FROM "User" WHERE id = ${bob.userId} FOR UPDATE
    `,
    );
    const add = () =>
      request(httpServer(app))
        .post(`/api/ledgers/${ledgerId}/members`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ email: 'bob@example.com', role: 'EDITOR' })
        .then();
    const additions = Promise.all([add(), add()]);
    try {
      await waitForBlockedQueries(prisma, 2);
    } finally {
      await lock.release();
    }
    const responses = await additions;
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)?.body).toMatchObject({
      errorCode: 'ALREADY_MEMBER',
    });
    expect(await prisma.ledgerMember.count({ where: { ledgerId, userId: bob.userId } })).toBe(1);
    expect(await prisma.ledgerPerson.count({ where: { ledgerId, userId: bob.userId } })).toBe(1);
  }, 15000);
});
