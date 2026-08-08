import { INestApplication } from '@nestjs/common';
import { LedgerMemberInfo, LedgerSummary } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, firstLedgerId, httpServer, registerAndLogin, resetDb } from './e2e-utils';

describe('Ledgers & members (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('isolates ledgers: a non-member sees 404, never 403', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await registerAndLogin(app, 'bob@example.com', 'Bob');
    const bob = await request(server())
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'sup3rsecret' });
    const bobToken = (bob.body as { accessToken: string }).accessToken;

    const ledgerId = await firstLedgerId(app, alice.token);
    const res = await request(server()).get(`/api/ledgers/${ledgerId}`).set(auth(bobToken));

    expect(res.status).toBe(404);
  });

  it('lets an owner add a member and enforces role on writes', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);

    const added = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });
    expect(added.status).toBe(201);
    expect((added.body as LedgerMemberInfo).role).toBe('VIEWER');

    // Viewer cannot rename the ledger.
    const denied = await request(server())
      .patch(`/api/ledgers/${ledgerId}`)
      .set(auth(bob.token))
      .send({ name: 'Hacked' });
    expect(denied.status).toBe(403);

    // Owner can.
    const renamed = await request(server())
      .patch(`/api/ledgers/${ledgerId}`)
      .set(auth(alice.token))
      .send({ name: 'Household' });
    expect(renamed.status).toBe(200);
  });

  it('rejects adding an unknown email (404) or an existing member (409)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);

    const unknown = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'ghost@example.com', role: 'VIEWER' });
    expect(unknown.status).toBe(404);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });
    const dup = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });
    expect(dup.status).toBe(409);
  });

  it('protects the last owner from demotion and self-removal', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const demote = await request(server())
      .patch(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
      .set(auth(alice.token))
      .send({ role: 'EDITOR' });
    expect(demote.status).toBe(409);

    const leave = await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
      .set(auth(alice.token));
    expect(leave.status).toBe(409);
  });

  it('deletes a ledger only with a matching confirm', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: 'Trip' });
    const ledger = created.body as LedgerSummary;

    const wrong = await request(server())
      .delete(`/api/ledgers/${ledger.id}?confirm=nope`)
      .set(auth(alice.token));
    expect(wrong.status).toBe(400);

    const ok = await request(server())
      .delete(`/api/ledgers/${ledger.id}?confirm=Trip`)
      .set(auth(alice.token));
    expect(ok.status).toBe(204);
  });
});
