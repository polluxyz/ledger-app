import { INestApplication } from '@nestjs/common';
import type { Counterparty, DebtEntry, DebtProposal, Paginated } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import {
  DAY,
  auth,
  createCounterparty,
  linkPair,
  pendingIncomingRequest,
  person,
  proposals,
  type Person,
} from './linking-utils';

/**
 * 連動的授權與資料隔離（spec 3b-2 §3.5、SC-K15）。
 *
 * 提議是本專案第一條「寫進別人帳裡」的路徑，所以這裡驗四件事：
 * 1. 第三人碰不到任何連動、提議、對象（一律 404，不洩漏存在與否）。
 * 2. 發起者不能替對方接受或拒絕自己的提議（403）。
 * 3. 接受者寫入自己帳時，帳本與帳戶的檢查以**接受者**的身分做；任何一項失敗，接受者那邊
 *    什麼都不留下，提議維持 PENDING。
 * 4. 接受者看到的提議不含發起者的備註、帳本、帳戶與對象名字。
 *
 * 每個情境都從真正的 HTTP 流程建立連動（`linkPair`），不直接寫資料庫。
 */
describe('Debt linking isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);

  let alice: Person;
  let bob: Person;
  let carol: Person;
  let aliceSide: string;
  let bobSide: string;

  /** Alice 與 Bob 連動，Alice 記一筆借出 120（帶備註、記進她的帳本與現金），Bob 收到提議。 */
  async function setupWithProposal(): Promise<DebtProposal> {
    alice = await person(app, 'alice@example.com', 'Alice');
    bob = await person(app, 'bob@example.com', 'Bob');
    carol = await person(app, 'carol@example.com', 'Carol');
    ({ aCounterpartyId: aliceSide, bCounterpartyId: bobSide } = await linkPair(app, alice, bob));

    await request(server())
      .post('/api/debt-entries')
      .set(auth(alice.token))
      .send({
        counterparty: { id: aliceSide },
        kind: 'LEND',
        amount: 120,
        date: DAY,
        note: 'Alice 的私人備註',
        record: { ledgerId: alice.ledgerId, accountId: alice.cashId },
      })
      .expect(201);

    return (await proposals(app, bob, 'incoming', 'PENDING'))[0]!;
  }

  async function bobEntries(): Promise<DebtEntry[]> {
    const res = await request(server())
      .get(`/api/counterparties/${bobSide}/entries`)
      .set(auth(bob.token))
      .expect(200);
    return (res.body as Paginated<DebtEntry>).items;
  }

  describe('a third person', () => {
    it('cannot accept, decline, or see the proposal (404)', async () => {
      const proposal = await setupWithProposal();

      await request(server())
        .post(`/api/debt-proposals/${proposal.id}/accept`)
        .set(auth(carol.token))
        .send({ record: null })
        .expect(404);
      await request(server())
        .post(`/api/debt-proposals/${proposal.id}/decline`)
        .set(auth(carol.token))
        .expect(404);
      expect(await proposals(app, carol, 'incoming')).toHaveLength(0);
      expect(await proposals(app, carol, 'outgoing')).toHaveLength(0);
    });

    it('cannot read, invite from, or unlink someone else’s counterparty (404)', async () => {
      await setupWithProposal();

      await request(server())
        .get(`/api/counterparties/${aliceSide}`)
        .set(auth(carol.token))
        .expect(404);
      await request(server())
        .post(`/api/counterparties/${aliceSide}/link-invites`)
        .set(auth(carol.token))
        .send({ email: 'bob@example.com' })
        .expect(404);
      await request(server())
        .post(`/api/counterparties/${aliceSide}/invite-links`)
        .set(auth(carol.token))
        .expect(404);
      await request(server())
        .delete(`/api/counterparties/${aliceSide}/link`)
        .set(auth(carol.token))
        .expect(404);
    });

    it('cannot accept a link invite addressed to someone else (404)', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      carol = await person(app, 'carol@example.com', 'Carol');
      const counterparty = await createCounterparty(app, alice, '小明');
      await request(server())
        .post(`/api/counterparties/${counterparty.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: bob.email })
        .expect(201);
      const invite = await pendingIncomingRequest(app, bob);

      await request(server())
        .post(`/api/friend-requests/${invite.id}/accept`)
        .set(auth(carol.token))
        .send({ counterparty: { name: 'Alice' } })
        .expect(404);
    });
  });

  describe('the proposer', () => {
    it('cannot accept or decline their own proposal (403)', async () => {
      const proposal = await setupWithProposal();

      await request(server())
        .post(`/api/debt-proposals/${proposal.id}/accept`)
        .set(auth(alice.token))
        .send({ record: null })
        .expect(403);
      await request(server())
        .post(`/api/debt-proposals/${proposal.id}/decline`)
        .set(auth(alice.token))
        .expect(403);
    });
  });

  describe('the recipient', () => {
    it('sees no note, ledger, account, or the proposer’s counterparty name', async () => {
      const proposal = await setupWithProposal();

      const serialized = JSON.stringify(proposal);
      expect(serialized).not.toContain('Alice 的私人備註');
      expect(serialized).not.toContain(alice.ledgerId);
      expect(serialized).not.toContain(alice.cashId);
      expect(serialized).not.toContain('小明');
      expect(serialized).not.toContain(aliceSide);
      expect(proposal.otherUser).toEqual({ id: alice.userId, name: 'Alice' });
      expect(proposal.counterpartyId).toBe(bobSide);
    });

    it('cannot link with a counterparty that is not their own (404)', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      const aliceCounterparty = await createCounterparty(app, alice, '小明');
      await request(server())
        .post(`/api/counterparties/${aliceCounterparty.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: bob.email })
        .expect(201);
      const invite = await pendingIncomingRequest(app, bob);

      await request(server())
        .post(`/api/friend-requests/${invite.id}/accept`)
        .set(auth(bob.token))
        .send({ counterparty: { id: aliceCounterparty.id } })
        .expect(404);
      // 失敗時邀請不被消耗，也沒有成為好友。
      expect((await pendingIncomingRequest(app, bob)).id).toBe(invite.id);
    });

    it.each([
      ['someone else’s account', 404, undefined],
      ['a ledger where they are only a VIEWER', 403, undefined],
      ['an archived ledger', 409, 'LEDGER_ARCHIVED'],
    ])(
      'recording into %s fails with %i and leaves nothing behind',
      async (label, status, errorCode) => {
        const proposal = await setupWithProposal();

        let record: { ledgerId: string; accountId?: string };
        if (label === 'someone else’s account') {
          record = { ledgerId: bob.ledgerId, accountId: carol.cashId };
        } else if (label === 'a ledger where they are only a VIEWER') {
          const carolShared = await createSharedLedger(app, carol.token);
          await request(server())
            .post(`/api/ledgers/${carolShared}/members`)
            .set(auth(carol.token))
            .send({ email: bob.email, role: 'VIEWER' })
            .expect(201);
          record = { ledgerId: carolShared, accountId: bob.cashId };
        } else {
          const bobShared = await createSharedLedger(app, bob.token);
          await request(server())
            .post(`/api/ledgers/${bobShared}/archive`)
            .set(auth(bob.token))
            .expect(201);
          record = { ledgerId: bobShared, accountId: bob.cashId };
        }

        const res = await request(server())
          .post(`/api/debt-proposals/${proposal.id}/accept`)
          .set(auth(bob.token))
          .send({ record });
        expect(res.status).toBe(status);
        if (errorCode !== undefined) {
          expect((res.body as { errorCode: string }).errorCode).toBe(errorCode);
        }

        expect(await bobEntries()).toHaveLength(0);
        const pending = await proposals(app, bob, 'incoming', 'PENDING');
        expect(pending.map((item) => item.id)).toEqual([proposal.id]);
      },
    );
  });

  describe('link information', () => {
    it('is only visible through one’s own linked counterparty', async () => {
      await setupWithProposal();

      const list = await request(server())
        .get('/api/counterparties')
        .set(auth(carol.token))
        .expect(200);
      expect((list.body as Paginated<Counterparty>).items).toHaveLength(0);

      const bobView = await request(server())
        .get(`/api/counterparties/${bobSide}`)
        .set(auth(bob.token))
        .expect(200);
      const link = (bobView.body as Counterparty).link!;
      expect(Object.keys(link).sort()).toEqual(['theirBalance', 'userId', 'userName']);
      expect(link.userId).toBe(alice.userId);
    });
  });
});
