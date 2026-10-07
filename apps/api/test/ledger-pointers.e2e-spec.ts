import { INestApplication } from '@nestjs/common';
import type { LedgerPerson, LedgerPointerResponse } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, linkPair, person, type Person } from './linking-utils';

/** 真正的 HTTP 與測試庫驗證指向、自動連動、明確 null、刪除 cascade 和跨帳本重用。 */
describe('Ledger pointers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const pointerUrl = (ledgerId: string, personId: string) =>
    `/api/ledgers/${ledgerId}/people/${personId}/pointer`;

  async function ledgerWithBob(
    alice: Person,
    bob: Person,
  ): Promise<{ ledgerId: string; bobId: string }> {
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email, role: 'VIEWER' })
      .expect(201);
    const listed = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(alice.token))
      .expect(200);
    const bobId = (listed.body as LedgerPerson[]).find((item) => item.userId === bob.userId)!.id;
    return { ledgerId, bobId };
  }

  it('sets a pointer, deletes it back to automatic link, and accepts explicit null', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const { aCounterpartyId: linkedId } = await linkPair(app, alice, bob);
    const manual = await createCounterparty(app, alice, 'Manual');
    const { ledgerId, bobId } = await ledgerWithBob(alice, bob);
    const url = pointerUrl(ledgerId, bobId);

    const set = await request(server())
      .put(url)
      .set(auth(alice.token))
      .send({ counterpartyId: manual.id })
      .expect(200);
    expect(set.body as LedgerPointerResponse).toEqual({ counterpartyId: manual.id, auto: false });

    const removed = await request(server()).delete(url).set(auth(alice.token)).expect(200);
    expect(removed.body as LedgerPointerResponse).toEqual({ counterpartyId: linkedId, auto: true });
    await request(server()).delete(url).set(auth(alice.token)).expect(200);

    const cleared = await request(server())
      .put(url)
      .set(auth(alice.token))
      .send({ counterpartyId: null })
      .expect(200);
    expect(cleared.body as LedgerPointerResponse).toEqual({ counterpartyId: null, auto: false });
    await request(server()).put(url).set(auth(alice.token)).send({}).expect(400);
  });

  it('cascades a deleted counterparty pointer and permits one counterparty across ledgers', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const target = await createCounterparty(app, alice, 'Target');
    const first = await ledgerWithBob(alice, bob);
    const second = await ledgerWithBob(alice, bob);
    for (const { ledgerId, bobId } of [first, second]) {
      await request(server())
        .put(pointerUrl(ledgerId, bobId))
        .set(auth(alice.token))
        .send({ counterpartyId: target.id })
        .expect(200);
    }
    expect(await prisma.ledgerPersonPointer.count({ where: { counterpartyId: target.id } })).toBe(
      2,
    );

    await request(server())
      .delete(`/api/counterparties/${target.id}`)
      .set(auth(alice.token))
      .expect(204);
    expect(await prisma.ledgerPersonPointer.count({ where: { counterpartyId: target.id } })).toBe(
      0,
    );
  });
});
