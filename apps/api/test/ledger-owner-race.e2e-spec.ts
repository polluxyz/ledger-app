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

/** R8：先鎖成員列，讓兩個請求都完成舊的擁有者計數後才可寫入。 */
describe('Ledger owner race (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  it('retains an owner when two owners remove each other concurrently', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com');
    const bob = await registerAndLogin(app, 'bob@example.com');
    const ledgerId = await createSharedLedger(app, alice.token);
    await request(httpServer(app))
      .post(`/api/ledgers/${ledgerId}/members`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ email: 'bob@example.com', role: 'OWNER' })
      .expect(201);
    const lock = await holdLock(
      prisma,
      (tx) => tx.$queryRaw`
      SELECT "userId" FROM "LedgerMember" WHERE "ledgerId" = ${ledgerId} FOR UPDATE
    `,
    );
    const remove = (token: string, target: string) =>
      request(httpServer(app))
        .delete(`/api/ledgers/${ledgerId}/members/${target}`)
        .set('Authorization', `Bearer ${token}`)
        .then();
    const removals = Promise.all([
      remove(alice.token, bob.userId),
      remove(bob.token, alice.userId),
    ]);
    try {
      await waitForBlockedQueries(prisma, 2);
    } finally {
      await lock.release();
    }
    const responses = await removals;
    expect(responses.map((r) => r.status).sort()).toEqual([204, 403]);
    expect(responses.find((r) => r.status === 403)?.body).toMatchObject({
      errorCode: 'CANNOT_MANAGE_OTHER_MEMBER',
    });
    expect(await prisma.ledgerMember.count({ where: { ledgerId, role: 'OWNER' } })).toBe(1);
  }, 15000);

  it('retains an owner when two owners demote each other concurrently', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com');
    const bob = await registerAndLogin(app, 'bob@example.com');
    const ledgerId = await createSharedLedger(app, alice.token);
    await request(httpServer(app))
      .post(`/api/ledgers/${ledgerId}/members`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ email: 'bob@example.com', role: 'OWNER' })
      .expect(201);
    const lock = await holdLock(
      prisma,
      (tx) => tx.$queryRaw`
      SELECT "userId" FROM "LedgerMember" WHERE "ledgerId" = ${ledgerId} FOR UPDATE
    `,
    );
    const change = (token: string, target: string) =>
      request(httpServer(app))
        .patch(`/api/ledgers/${ledgerId}/members/${target}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'EDITOR' })
        .then();
    const changes = Promise.all([change(alice.token, bob.userId), change(bob.token, alice.userId)]);
    try {
      await waitForBlockedQueries(prisma, 2);
    } finally {
      await lock.release();
    }
    const responses = await changes;
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)?.body).toMatchObject({
      errorCode: 'LAST_OWNER_CANNOT_LEAVE',
    });
    expect(await prisma.ledgerMember.count({ where: { ledgerId, role: 'OWNER' } })).toBe(1);
  }, 15000);
});
