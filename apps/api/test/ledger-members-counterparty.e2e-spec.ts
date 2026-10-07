import { INestApplication } from '@nestjs/common';
import type { ApiErrorResponse, LedgerMemberInfo, LedgerPerson } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, createCounterparty, linkPair, person } from './linking-utils';

/**
 * SC-F8（spec §4.3）：帳本頁新增成員的兩種入口。`POST …/members { counterpartyId, role }`
 * 只收呼叫者已連動的對象，後端把連動的帳號照 email 版本的路徑加入；`POST …/people
 * { name, counterpartyId }` 建虛擬成員並在同一個交易替呼叫者設定指向。全程走真正的
 * HTTP，資料隔離（別人的對象 404、成員數不變、失敗不留指向）直接對資料庫驗證。
 */
describe('Ledger members via counterparty (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);

  async function listMembers(ledgerId: string, token: string): Promise<LedgerMemberInfo[]> {
    const response = await request(server())
      .get(`/api/ledgers/${ledgerId}/members`)
      .set(auth(token))
      .expect(200);
    return response.body as LedgerMemberInfo[];
  }

  it('SC-F8 adds the linked account as a member with the submitted role', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const { aCounterpartyId } = await linkPair(app, alice, bob);
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');

    const added = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ counterpartyId: aCounterpartyId, role: 'EDITOR' })
      .expect(201);
    expect(added.body as LedgerMemberInfo).toMatchObject({
      userId: bob.userId,
      email: 'bob@example.com',
      role: 'EDITOR',
    });

    const members = await listMembers(ledgerId, alice.token);
    expect(members.find((member) => member.userId === bob.userId)?.role).toBe('EDITOR');
  });

  it('rejects an unlinked counterparty with COUNTERPARTY_NOT_LINKED and keeps members unchanged', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const landlord = await createCounterparty(app, alice, 'Landlord');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    const membersBefore = await listMembers(ledgerId, alice.token);

    const rejected = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ counterpartyId: landlord.id, role: 'EDITOR' })
      .expect(400);
    expect((rejected.body as ApiErrorResponse).errorCode).toBe('COUNTERPARTY_NOT_LINKED');
    expect(await listMembers(ledgerId, alice.token)).toEqual(membersBefore);
  });

  it('hides another user’s counterparty with 404 and keeps members unchanged', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const mallory = await person(app, 'mallory@example.com', 'Mallory');
    const { aCounterpartyId } = await linkPair(app, eve, mallory);
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    const membersBefore = await listMembers(ledgerId, alice.token);

    const hidden = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ counterpartyId: aCounterpartyId, role: 'VIEWER' })
      .expect(404);
    expect((hidden.body as ApiErrorResponse).errorCode).toBe('NOT_FOUND');
    expect(await listMembers(ledgerId, alice.token)).toEqual(membersBefore);
  });

  it('SC-F8 creates a virtual member and the caller’s pointer in one request', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const landlord = await createCounterparty(app, alice, 'Landlord');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(alice.token))
      .send({ name: 'Landlord', counterpartyId: landlord.id })
      .expect(201);
    const guest = created.body as LedgerPerson;
    expect(guest).toMatchObject({ name: 'Landlord', userId: null, status: 'GUEST' });

    // 指向沒有獨立的 GET 端點，直接對資料庫驗證呼叫者的指向已隨虛擬成員一起落地。
    const pointer = await prisma.ledgerPersonPointer.findUnique({
      where: { userId_ledgerPersonId: { userId: alice.userId, ledgerPersonId: guest.id } },
    });
    expect(pointer?.counterpartyId).toBe(landlord.id);
  });

  it('returns 404 for a foreign counterparty without creating a virtual member or pointer', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const eve = await person(app, 'eve@example.com', 'Eve');
    const mallory = await person(app, 'mallory@example.com', 'Mallory');
    const { aCounterpartyId } = await linkPair(app, eve, mallory);
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');

    const hidden = await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(alice.token))
      .send({ name: 'Hidden', counterpartyId: aCounterpartyId })
      .expect(404);
    expect((hidden.body as ApiErrorResponse).errorCode).toBe('NOT_FOUND');
    // 共享帳本建立時只有擁有者一筆 LedgerPerson；失敗的請求不得留下任何名單或指向。
    expect(await prisma.ledgerPerson.count({ where: { ledgerId } })).toBe(1);
    expect(await prisma.ledgerPersonPointer.count()).toBe(0);
  });

  it('rejects a duplicate guest name with 409 and leaves no pointer row', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const landlord = await createCounterparty(app, alice, 'Landlord');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(alice.token))
      .send({ name: 'Landlord' })
      .expect(201);

    const duplicate = await request(server())
      .post(`/api/ledgers/${ledgerId}/people`)
      .set(auth(alice.token))
      .send({ name: 'Landlord', counterpartyId: landlord.id })
      .expect(409);
    expect((duplicate.body as ApiErrorResponse).errorCode).toBe('LEDGER_PERSON_NAME_TAKEN');
    expect(await prisma.ledgerPerson.count({ where: { ledgerId, userId: null } })).toBe(1);
    expect(await prisma.ledgerPersonPointer.count()).toBe(0);
  });
});
