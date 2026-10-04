import { INestApplication } from '@nestjs/common';
import type { ApiErrorResponse, LedgerPerson } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 帳本裡的人的端對端驗證：共享帳本名單、成員離開再加入、非成員管理、資料隔離與角色權限。
 * 以真正的 HTTP 請求及測試資料庫驗證回應，並直接寫一筆交易確認刪除保護條件。
 */
describe('Ledger people (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function addMember(
    ledgerId: string,
    ownerToken: string,
    email: string,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<void> {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(ownerToken))
      .send({ email, role })
      .expect(201);
  }

  async function listPeople(ledgerId: string, token: string): Promise<LedgerPerson[]> {
    const response = await request(server())
      .get(`/api/ledgers/${ledgerId}/people`)
      .set(auth(token))
      .expect(200);
    return response.body as LedgerPerson[];
  }

  it('SC-E1 lists the creator and members, then preserves a person across leave and rejoin', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    await registerAndLogin(app, 'carol@example.com', 'Carol');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    await addMember(ledgerId, alice.token, 'bob@example.com', 'EDITOR');
    await addMember(ledgerId, alice.token, 'carol@example.com', 'VIEWER');

    const initial = await listPeople(ledgerId, alice.token);
    expect(initial).toHaveLength(3);
    expect(initial.find((person) => person.userId === alice.userId)).toMatchObject({
      name: 'Alice',
      status: 'MEMBER',
    });
    const bobPerson = initial.find((person) => person.userId === bob.userId)!;
    expect(bobPerson.status).toBe('MEMBER');

    await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${bob.userId}`)
      .set(auth(bob.token))
      .expect(204);
    const afterLeave = await listPeople(ledgerId, alice.token);
    expect(afterLeave).toHaveLength(3);
    expect(afterLeave.find((person) => person.id === bobPerson.id)?.status).toBe('LEFT');

    await addMember(ledgerId, alice.token, 'bob@example.com', 'EDITOR');
    const afterRejoin = await listPeople(ledgerId, alice.token);
    expect(afterRejoin).toHaveLength(3);
    expect(afterRejoin.find((person) => person.userId === bob.userId)).toMatchObject({
      id: bobPerson.id,
      status: 'MEMBER',
    });
  });

  it('returns 404 for every people endpoint on a personal ledger', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const personalLedgerId = await prisma.ledgerMember
      .findFirstOrThrow({ where: { userId: alice.userId }, select: { ledgerId: true } })
      .then((membership) => membership.ledgerId);
    const base = `/api/ledgers/${personalLedgerId}/people`;
    const missingId = '00000000-0000-0000-0000-000000000000';

    await request(server()).get(base).set(auth(alice.token)).expect(404);
    await request(server()).post(base).set(auth(alice.token)).send({ name: 'Guest' }).expect(404);
    await request(server())
      .patch(`${base}/${missingId}`)
      .set(auth(alice.token))
      .send({ name: 'Guest' })
      .expect(404);
    await request(server()).delete(`${base}/${missingId}`).set(auth(alice.token)).expect(404);
  });

  it('SC-E10 trims, validates, renames, and safely deletes guests', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    const base = `/api/ledgers/${ledgerId}/people`;

    const ameiResponse = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: ' 阿美 ' })
      .expect(201);
    const amei = ameiResponse.body as LedgerPerson;
    expect(amei).toMatchObject({ name: '阿美', userId: null, status: 'GUEST' });

    const duplicate = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: '阿美' })
      .expect(409);
    expect((duplicate.body as ApiErrorResponse).errorCode).toBe('LEDGER_PERSON_NAME_TAKEN');
    const duplicateWithWhitespace = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: ' 阿美 ' })
      .expect(409);
    expect((duplicateWithWhitespace.body as ApiErrorResponse).errorCode).toBe(
      'LEDGER_PERSON_NAME_TAKEN',
    );

    await request(server()).post(base).set(auth(alice.token)).send({ name: '   ' }).expect(400);
    await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: 'a'.repeat(51) })
      .expect(400);

    const renamedResponse = await request(server())
      .patch(`${base}/${amei.id}`)
      .set(auth(alice.token))
      .send({ name: ' 阿梅 ' })
      .expect(200);
    expect((renamedResponse.body as LedgerPerson).name).toBe('阿梅');

    const members = await listPeople(ledgerId, alice.token);
    const alicePerson = members.find((person) => person.userId === alice.userId)!;
    const memberPatch = await request(server())
      .patch(`${base}/${alicePerson.id}`)
      .set(auth(alice.token))
      .send({ name: 'Changed' })
      .expect(400);
    expect((memberPatch.body as ApiErrorResponse).errorCode).toBe('VALIDATION_FAILED');
    const memberDelete = await request(server())
      .delete(`${base}/${alicePerson.id}`)
      .set(auth(alice.token))
      .expect(400);
    expect((memberDelete.body as ApiErrorResponse).errorCode).toBe('VALIDATION_FAILED');

    const small = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: '小美' })
      .expect(201)
      .then((response) => response.body as LedgerPerson);
    await request(server()).delete(`${base}/${small.id}`).set(auth(alice.token)).expect(204);
    expect((await listPeople(ledgerId, alice.token)).some((person) => person.id === small.id)).toBe(
      false,
    );
    await request(server()).post(base).set(auth(alice.token)).send({ name: '小美' }).expect(201);

    const transaction = await prisma.transaction.create({
      data: {
        ledgerId,
        creatorId: alice.userId,
        type: 'EXPENSE',
        amount: 1000,
        date: new Date('2026-10-04T00:00:00.000Z'),
        title: 'Ticket',
        payerPersonId: amei.id,
      },
    });
    const inUse = await request(server())
      .delete(`${base}/${amei.id}`)
      .set(auth(alice.token))
      .expect(409);
    expect((inUse.body as ApiErrorResponse).errorCode).toBe('LEDGER_PERSON_IN_USE');

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { deletedAt: new Date() },
    });
    await request(server()).delete(`${base}/${amei.id}`).set(auth(alice.token)).expect(204);
    await request(server())
      .patch(`${base}/${amei.id}`)
      .set(auth(alice.token))
      .send({ name: '阿梅' })
      .expect(404);
  });

  it('allows VIEWER reads, rejects their writes, hides people from non-members, and blocks archived writes', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const eve = await registerAndLogin(app, 'eve@example.com', 'Eve');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    await addMember(ledgerId, alice.token, 'bob@example.com', 'VIEWER');
    const base = `/api/ledgers/${ledgerId}/people`;
    const guest = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: 'Guest' })
      .expect(201)
      .then((response) => response.body as LedgerPerson);
    const alicePerson = (await listPeople(ledgerId, alice.token)).find(
      (person) => person.userId === alice.userId,
    )!;

    await request(server()).get(base).set(auth(bob.token)).expect(200);
    const viewerPost = await request(server())
      .post(base)
      .set(auth(bob.token))
      .send({ name: 'Denied' })
      .expect(403);
    expect((viewerPost.body as ApiErrorResponse).errorCode).toBe('FORBIDDEN');
    await request(server())
      .patch(`${base}/${guest.id}`)
      .set(auth(bob.token))
      .send({ name: 'Denied' })
      .expect(403);
    await request(server()).delete(`${base}/${guest.id}`).set(auth(bob.token)).expect(403);

    await request(server()).get(base).set(auth(eve.token)).expect(404);
    await request(server()).post(base).set(auth(eve.token)).send({ name: 'Hidden' }).expect(404);
    await request(server())
      .patch(`${base}/${guest.id}`)
      .set(auth(eve.token))
      .send({ name: 'Hidden' })
      .expect(404);
    await request(server()).delete(`${base}/${guest.id}`).set(auth(eve.token)).expect(404);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/archive`)
      .set(auth(alice.token))
      .expect(201);
    const archivedWrite = await request(server())
      .post(base)
      .set(auth(alice.token))
      .send({ name: 'Archived' })
      .expect(409);
    expect((archivedWrite.body as ApiErrorResponse).errorCode).toBe('LEDGER_ARCHIVED');
    expect(alicePerson.status).toBe('MEMBER');
  });
});
