import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  DebtEntry,
  DebtProposal,
  Friend,
  FriendInviteLinkAccepted,
  FriendInviteLinkCreated,
  FriendInviteLinkPreview,
  FriendRequest,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, listAccounts, resetDb } from './e2e-utils';
import {
  DAY,
  auth,
  createCounterparty,
  getCounterparty,
  linkPair,
  pendingIncomingRequest,
  person,
  proposals,
  type Person,
} from './linking-utils';

/**
 * 往來帳連動的完整流程（spec 3b-2 §6 的 SC-K1～K14、K16、K17）。
 *
 * 策略：Alice 與 Bob 兩個真的使用者，全部走 HTTP。每個情境從「記一筆 → 對方收到提議 →
 * 接受或拒絕」一路驗到雙方的往來餘額、帳戶餘額、同步狀態，不看資料庫內部。
 * 隔離與授權另在 `debt-linking-isolation.e2e-spec.ts`。
 */
describe('Debt linking (e2e)', () => {
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
  let aliceSide: string;
  let bobSide: string;

  async function linkAliceAndBob(): Promise<void> {
    alice = await person(app, 'alice@example.com', 'Alice');
    bob = await person(app, 'bob@example.com', 'Bob');
    ({ aCounterpartyId: aliceSide, bCounterpartyId: bobSide } = await linkPair(app, alice, bob));
  }

  function record(who: Person) {
    return { ledgerId: who.ledgerId, accountId: who.cashId };
  }

  async function post(who: Person, body: Record<string, unknown>) {
    return request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .send({ date: DAY, record: null, ...body });
  }

  async function entries(who: Person, counterpartyId: string): Promise<DebtEntry[]> {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .set(auth(who.token))
      .expect(200);
    return (res.body as Paginated<DebtEntry>).items;
  }

  async function balance(who: Person, counterpartyId: string): Promise<number> {
    return (await getCounterparty(app, who, counterpartyId)).balance;
  }

  async function cash(who: Person): Promise<number> {
    return (await listAccounts(app, who.token)).find((account) => account.id === who.cashId)!
      .balance;
  }

  async function incoming(who: Person): Promise<DebtProposal> {
    return (await proposals(app, who, 'incoming', 'PENDING'))[0]!;
  }

  async function accept(who: Person, proposalId: string, body: Record<string, unknown> = {}) {
    return request(server())
      .post(`/api/debt-proposals/${proposalId}/accept`)
      .set(auth(who.token))
      .send(body);
  }

  async function decline(who: Person, proposalId: string) {
    return request(server())
      .post(`/api/debt-proposals/${proposalId}/decline`)
      .set(auth(who.token))
      .expect(200);
  }

  /** Alice 借出、Bob 接受（不記入帳本），雙方配對。回傳 Alice 那筆。 */
  async function syncedLend(amount: number): Promise<DebtEntry> {
    const res = await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount });
    expect(res.status).toBe(201);
    await accept(bob, (await incoming(bob)).id, { record: null }).then((r) =>
      expect(r.status).toBe(200),
    );
    return (res.body as { entries: DebtEntry[] }).entries[0]!;
  }

  describe('counterparties (SC-K1)', () => {
    it('creates a trimmed name, rejects duplicates, and filters by q', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      const created = await createCounterparty(app, alice, ' 小明 ');
      expect(created).toMatchObject({ name: '小明', balance: 0, link: null });

      const duplicate = await request(server())
        .post('/api/counterparties')
        .set(auth(alice.token))
        .send({ name: '小明' });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as { errorCode: string }).errorCode).toBe('COUNTERPARTY_NAME_TAKEN');

      await createCounterparty(app, alice, 'Bob Chen');
      const found = await request(server())
        .get('/api/counterparties')
        .query({ q: '明' })
        .set(auth(alice.token))
        .expect(200);
      expect((found.body as Paginated<Counterparty>).items.map((c) => c.name)).toEqual(['小明']);
      const caseless = await request(server())
        .get('/api/counterparties')
        .query({ q: 'bob' })
        .set(auth(alice.token))
        .expect(200);
      expect((caseless.body as Paginated<Counterparty>).items.map((c) => c.name)).toEqual([
        'Bob Chen',
      ]);
    });
  });

  describe('linking (SC-K2～K4)', () => {
    it('links by email, makes them friends, and leaves earlier entries alone', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      // 連動前的紀錄不同步（決策 59）。
      await post(alice, { counterparty: { name: '小明' }, kind: 'LEND', amount: 50 }).then((r) =>
        expect(r.status).toBe(201),
      );
      const before = (
        (await request(server()).get('/api/counterparties').set(auth(alice.token)))
          .body as Paginated<Counterparty>
      ).items[0]!;

      const invite = await request(server())
        .post(`/api/counterparties/${before.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: 'BOB@example.com' });
      expect(invite.status).toBe(201);
      expect((invite.body as FriendRequest).forLink).toBe(true);

      const received = await pendingIncomingRequest(app, bob);
      expect(received).toMatchObject({ forLink: true, counterpart: { name: 'Alice' } });
      await request(server())
        .post(`/api/friend-requests/${received.id}/accept`)
        .set(auth(bob.token))
        .send({ counterparty: { name: '阿A' } })
        .expect(200);

      const aliceView = await getCounterparty(app, alice, before.id);
      expect(aliceView).toMatchObject({
        balance: 50,
        link: { userId: bob.userId, userName: 'Bob', theirBalance: 0 },
      });
      const bobList = await request(server())
        .get('/api/counterparties')
        .set(auth(bob.token))
        .expect(200);
      expect((bobList.body as Paginated<Counterparty>).items).toEqual([
        expect.objectContaining({
          name: '阿A',
          balance: 0,
          link: { userId: alice.userId, userName: 'Alice', theirBalance: -50 },
        }),
      ]);
      const friends = await request(server()).get('/api/friends').set(auth(alice.token));
      expect((friends.body as Paginated<Friend>).items.map((f) => f.userId)).toEqual([bob.userId]);
      expect(await proposals(app, bob, 'incoming')).toHaveLength(0);
    });

    it('links by invite link; a linked counterparty is refused without consuming the link', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      const carol = await person(app, 'carol@example.com', 'Carol');
      // Bob 已經把「小卡」連到 Carol。
      const { bCounterpartyId: bobsCarol } = await linkPair(app, carol, bob, 'Bob', '小卡');
      const bobsOld = await createCounterparty(app, bob, '愛麗絲');

      const aliceSideCp = await createCounterparty(app, alice, '小明');
      const created = await request(server())
        .post(`/api/counterparties/${aliceSideCp.id}/invite-links`)
        .set(auth(alice.token))
        .expect(201);
      const { token } = created.body as FriendInviteLinkCreated;

      const preview = await request(server())
        .post('/api/friend-invite-links/preview')
        .set(auth(bob.token))
        .send({ token })
        .expect(200);
      expect(preview.body as FriendInviteLinkPreview).toMatchObject({
        inviterName: 'Alice',
        forLink: true,
      });

      const refused = await request(server())
        .post('/api/friend-invite-links/accept')
        .set(auth(bob.token))
        .send({ token, counterparty: { id: bobsCarol } });
      expect(refused.status).toBe(409);
      expect((refused.body as { errorCode: string }).errorCode).toBe('COUNTERPARTY_LINKED');

      const missing = await request(server())
        .post('/api/friend-invite-links/accept')
        .set(auth(bob.token))
        .send({ token });
      expect(missing.status).toBe(400);

      const accepted = await request(server())
        .post('/api/friend-invite-links/accept')
        .set(auth(bob.token))
        .send({ token, counterparty: { id: bobsOld.id } });
      expect(accepted.status).toBe(201);
      expect((accepted.body as FriendInviteLinkAccepted).counterpartyId).toBe(bobsOld.id);
      expect((await getCounterparty(app, bob, bobsOld.id)).link?.userId).toBe(alice.userId);
    });

    it('rejects a second link and an invite when the other side already invited', async () => {
      await linkAliceAndBob();
      const another = await createCounterparty(app, alice, '另一個');
      const again = await request(server())
        .post(`/api/counterparties/${another.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: bob.email });
      expect(again.status).toBe(409);
      expect((again.body as { errorCode: string }).errorCode).toBe('ALREADY_LINKED');

      const carol = await person(app, 'carol@example.com', 'Carol');
      const carolSide = await createCounterparty(app, carol, 'Alice');
      await request(server())
        .post(`/api/counterparties/${carolSide.id}/link-invites`)
        .set(auth(carol.token))
        .send({ email: alice.email })
        .expect(201);
      const reverse = await request(server())
        .post(`/api/counterparties/${another.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: carol.email });
      expect(reverse.status).toBe(409);
      expect((reverse.body as { errorCode: string }).errorCode).toBe('LINK_INVITE_FROM_THEM');
    });
  });

  describe('proposals (SC-K5～K9)', () => {
    it('SC-K5: a lend reaches the other side as a borrow once accepted', async () => {
      await linkAliceAndBob();
      const aliceCash = await cash(alice);
      const bobCash = await cash(bob);

      await post(alice, {
        counterparty: { id: aliceSide },
        kind: 'LEND',
        amount: 120,
        record: record(alice),
      }).then((r) => expect(r.status).toBe(201));
      expect(await balance(alice, aliceSide)).toBe(120);
      expect(await cash(alice)).toBe(aliceCash - 120);
      expect((await entries(alice, aliceSide))[0]!.sync).toBe('PENDING');
      expect(await balance(bob, bobSide)).toBe(0);

      const proposal = await incoming(bob);
      expect(proposal).toMatchObject({
        type: 'CREATE',
        entryKind: 'BORROW',
        amount: 120,
        settle: false,
        otherUser: { name: 'Alice' },
      });

      const missingRecord = await accept(bob, proposal.id);
      expect(missingRecord.status).toBe(400);

      const res = await accept(bob, proposal.id, { record: record(bob) });
      expect(res.status).toBe(200);
      expect((res.body as DebtProposal).status).toBe('ACCEPTED');

      expect(await balance(bob, bobSide)).toBe(-120);
      expect(await cash(bob)).toBe(bobCash + 120);
      const [bobEntry] = await entries(bob, bobSide);
      expect(bobEntry).toMatchObject({ kind: 'BORROW', delta: -120, paired: true, sync: 'SYNCED' });
      expect((await entries(alice, aliceSide))[0]).toMatchObject({ paired: true, sync: 'SYNCED' });
    });

    it('SC-K6: a repayment mirrors REPAY ↔ COLLECT and both reach zero', async () => {
      await linkAliceAndBob();
      await syncedLend(120);

      const res = await post(bob, {
        counterparty: { id: bobSide },
        kind: 'REPAYMENT',
        amount: 120,
      });
      expect(res.status).toBe(201);
      expect((res.body as { entries: DebtEntry[] }).entries[0]!.kind).toBe('REPAY');

      const proposal = await incoming(alice);
      expect(proposal.entryKind).toBe('COLLECT');
      await accept(alice, proposal.id, { record: null }).then((r) => expect(r.status).toBe(200));

      expect((await entries(alice, aliceSide))[0]).toMatchObject({ kind: 'COLLECT', delta: -120 });
      expect(await balance(alice, aliceSide)).toBe(0);
      expect(await balance(bob, bobSide)).toBe(0);
    });

    it('SC-K7: a declined proposal leaves the other side untouched', async () => {
      await linkAliceAndBob();
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 100 });
      await decline(bob, (await incoming(bob)).id);

      expect((await entries(alice, aliceSide))[0]).toMatchObject({
        delta: 100,
        sync: 'DECLINED',
        paired: false,
      });
      expect(await entries(bob, bobSide)).toHaveLength(0);
    });

    it('SC-K8: acceptance checks the recipient’s own balance and settles against it', async () => {
      await linkAliceAndBob();
      // Alice 借出 100、Bob 拒絕：Alice +100，Bob 0。
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 100 });
      await decline(bob, (await incoming(bob)).id);

      await post(alice, { counterparty: { id: aliceSide }, kind: 'REPAYMENT', amount: 30 });
      const nothing = await incoming(bob);
      const refused = await accept(bob, nothing.id, { record: null });
      expect(refused.status).toBe(409);
      expect((refused.body as { errorCode: string }).errorCode).toBe('NOTHING_TO_REPAY');
      expect((await incoming(bob)).id).toBe(nothing.id);
      await decline(bob, nothing.id);

      // Alice +70；讓 Bob 有 −60：Alice 借出 60 並被接受。
      await syncedLend(60);
      expect(await balance(alice, aliceSide)).toBe(130);
      expect(await balance(bob, bobSide)).toBe(-60);

      // Alice 收 50 並以此結清：Alice 補 SETTLEMENT −80；Bob 用自己的 −60 算：REPAY +50、SETTLEMENT +10。
      await post(alice, {
        counterparty: { id: aliceSide },
        kind: 'REPAYMENT',
        amount: 50,
        settle: true,
      }).then((r) => expect(r.status).toBe(201));
      const settle = await incoming(bob);
      expect(settle).toMatchObject({ entryKind: 'REPAY', amount: 50, settle: true });
      await accept(bob, settle.id, { record: null }).then((r) => expect(r.status).toBe(200));

      expect(await balance(alice, aliceSide)).toBe(0);
      expect(await balance(bob, bobSide)).toBe(0);
      const bobKinds = (await entries(bob, bobSide)).map((e) => [e.kind, e.delta]);
      expect(bobKinds).toEqual(
        expect.arrayContaining([
          ['REPAY', 50],
          ['SETTLEMENT', 10],
        ]),
      );
    });

    it('SC-K9: forgiveness clears only what the recipient owes, without a transaction', async () => {
      await linkAliceAndBob();
      await syncedLend(50);
      // Bob 還 20，Alice 拒絕：Alice +50、Bob −30。
      await post(bob, { counterparty: { id: bobSide }, kind: 'REPAYMENT', amount: 20 });
      await decline(alice, (await incoming(alice)).id);

      await request(server())
        .post(`/api/counterparties/${aliceSide}/forgive`)
        .set(auth(alice.token))
        .expect(201);
      const proposal = await incoming(bob);
      expect(proposal).toMatchObject({ entryKind: 'FORGIVEN', amount: 50 });
      const withRecord = await accept(bob, proposal.id, { record: null });
      expect(withRecord.status).toBe(400);
      await accept(bob, proposal.id).then((r) => expect(r.status).toBe(200));

      // 免除的日期是「現在」，不一定排在固定測試日期的前面，所以依種類找。
      const forgiven = (await entries(bob, bobSide)).find((e) => e.kind === 'FORGIVEN');
      expect(forgiven).toMatchObject({ kind: 'FORGIVEN', delta: 30, transactionId: null });
      expect(await balance(bob, bobSide)).toBe(0);
    });
  });

  describe('changes to synced entries (SC-K10, SC-K11)', () => {
    it('SC-K10: amending a synced entry updates the other side once accepted', async () => {
      await linkAliceAndBob();
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 120 });
      await accept(bob, (await incoming(bob)).id, { record: record(bob) });
      const aliceEntry = (await entries(alice, aliceSide))[0]!;

      await request(server())
        .patch(`/api/debt-entries/${aliceEntry.id}`)
        .set(auth(alice.token))
        .send({ amount: 150 })
        .expect(200);
      const amend = await incoming(bob);
      expect(amend).toMatchObject({ type: 'AMEND', entryKind: 'BORROW', amount: 150 });
      await accept(bob, amend.id).then((r) => expect(r.status).toBe(200));

      const bobEntry = (await entries(bob, bobSide))[0]!;
      expect(bobEntry.delta).toBe(-150);
      const bobTransaction = await request(server())
        .get(`/api/ledgers/${bob.ledgerId}/transactions`)
        .set(auth(bob.token))
        .expect(200);
      expect(
        (bobTransaction.body as Paginated<Transaction>).items.find(
          (t) => t.id === bobEntry.transactionId,
        )?.amount,
      ).toBe(150);

      // 對方還沒回應又改兩次：只留最新的一筆待確認。
      for (const amount of [160, 170]) {
        await request(server())
          .patch(`/api/debt-entries/${aliceEntry.id}`)
          .set(auth(alice.token))
          .send({ amount })
          .expect(200);
      }
      const outgoing = await proposals(app, alice, 'outgoing');
      expect(outgoing.filter((p) => p.status === 'PENDING').map((p) => p.amount)).toEqual([170]);
      expect(outgoing.filter((p) => p.status === 'CANCELLED').map((p) => p.amount)).toEqual([160]);

      // 只改備註不送。
      await request(server())
        .patch(`/api/debt-entries/${aliceEntry.id}`)
        .set(auth(alice.token))
        .send({ note: '只是備註' })
        .expect(200);
      expect(await proposals(app, bob, 'incoming', 'PENDING')).toHaveLength(1);
    });

    it('SC-K11: deleting a synced entry sends a deletion; deleting a pending one withdraws it', async () => {
      await linkAliceAndBob();
      const synced = await syncedLend(100);

      await request(server())
        .delete(`/api/debt-entries/${synced.id}`)
        .set(auth(alice.token))
        .expect(204);
      expect((await entries(bob, bobSide))[0]!.paired).toBe(false);
      const deletion = await incoming(bob);
      expect(deletion).toMatchObject({ type: 'DELETE', amount: 100 });
      await decline(bob, deletion.id);
      expect(await entries(bob, bobSide)).toHaveLength(1);

      const pending = await post(alice, {
        counterparty: { id: aliceSide },
        kind: 'LEND',
        amount: 5,
      });
      const pendingId = (pending.body as { entries: DebtEntry[] }).entries[0]!.id;
      await request(server())
        .delete(`/api/debt-entries/${pendingId}`)
        .set(auth(alice.token))
        .expect(204);
      expect(await proposals(app, bob, 'incoming', 'PENDING')).toHaveLength(0);
      expect((await proposals(app, alice, 'outgoing', 'CANCELLED')).map((p) => p.amount)).toEqual([
        5,
      ]);
    });

    it('accepting a deletion removes the other side’s entry and its transaction', async () => {
      await linkAliceAndBob();
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 80 });
      await accept(bob, (await incoming(bob)).id, { record: record(bob) });
      const bobCash = await cash(bob);
      const aliceEntry = (await entries(alice, aliceSide))[0]!;

      await request(server())
        .delete(`/api/debt-entries/${aliceEntry.id}`)
        .set(auth(alice.token))
        .expect(204);
      await accept(bob, (await incoming(bob)).id).then((r) => expect(r.status).toBe(200));

      expect(await entries(bob, bobSide)).toHaveLength(0);
      expect(await cash(bob)).toBe(bobCash - 80);
    });
  });

  describe('unlinking (SC-K12, SC-K13)', () => {
    async function setupWithPending() {
      await linkAliceAndBob();
      await syncedLend(40);
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 7 });
    }

    async function expectUnlinked() {
      const aliceView = await getCounterparty(app, alice, aliceSide);
      const bobView = await getCounterparty(app, bob, bobSide);
      expect(aliceView).toMatchObject({ name: '小明', link: null, balance: 47 });
      expect(bobView).toMatchObject({ name: '阿A', link: null, balance: -40 });
      expect((await entries(alice, aliceSide)).every((e) => !e.paired)).toBe(true);
      expect((await entries(bob, bobSide)).every((e) => !e.paired)).toBe(true);
      expect(await proposals(app, bob, 'incoming', 'PENDING')).toHaveLength(0);
      const friends = await request(server()).get('/api/friends').set(auth(alice.token));
      expect((friends.body as Paginated<Friend>).items).toHaveLength(0);
    }

    it('SC-K12: unlinking keeps both counterparties, names and entries', async () => {
      await setupWithPending();
      await request(server())
        .delete(`/api/counterparties/${aliceSide}/link`)
        .set(auth(alice.token))
        .expect(204);
      await expectUnlinked();
      await request(server())
        .delete(`/api/counterparties/${aliceSide}/link`)
        .set(auth(alice.token))
        .expect(404);
    });

    it('SC-K12: removing the friend unlinks as well', async () => {
      await setupWithPending();
      await request(server())
        .delete(`/api/friends/${alice.userId}`)
        .set(auth(bob.token))
        .expect(204);
      await expectUnlinked();
    });

    it('SC-K12: pending link invites between them are cancelled', async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      const { bCounterpartyId } = await linkPair(app, alice, bob);
      await request(server())
        .delete(`/api/counterparties/${bCounterpartyId}/link`)
        .set(auth(bob.token))
        .expect(204);
      const again = await createCounterparty(app, alice, '再一次');
      await request(server())
        .post(`/api/counterparties/${again.id}/link-invites`)
        .set(auth(alice.token))
        .send({ email: bob.email })
        .expect(201);
      // 再次連動前又解除（此時兩人已不是好友）：DELETE /friends 回 404，而且不動那筆邀請。
      await request(server())
        .delete(`/api/friends/${alice.userId}`)
        .set(auth(bob.token))
        .expect(404);
      expect((await pendingIncomingRequest(app, bob)).forLink).toBe(true);
    });

    it('SC-K13: a linked counterparty cannot be deleted', async () => {
      await linkAliceAndBob();
      const res = await request(server())
        .delete(`/api/counterparties/${aliceSide}`)
        .set(auth(alice.token));
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('COUNTERPARTY_LINKED');
    });
  });

  describe('their balance, races, and unsynced kinds (SC-K14, SC-K16, SC-K17)', () => {
    it('SC-K14: theirBalance is the other side’s balance from my point of view', async () => {
      await linkAliceAndBob();
      await syncedLend(100);
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 20 });
      await decline(bob, (await incoming(bob)).id);

      expect((await getCounterparty(app, alice, aliceSide)).link?.theirBalance).toBe(100);
      expect((await getCounterparty(app, bob, bobSide)).link?.theirBalance).toBe(-120);
    });

    it('SC-K16: two simultaneous accepts write only one entry', async () => {
      await linkAliceAndBob();
      await post(alice, { counterparty: { id: aliceSide }, kind: 'LEND', amount: 60 });
      const proposal = await incoming(bob);

      const results = await Promise.all([
        accept(bob, proposal.id, { record: null }),
        accept(bob, proposal.id, { record: null }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await entries(bob, bobSide)).toHaveLength(1);
      expect(await balance(bob, bobSide)).toBe(-60);
    });

    it('SC-K17: paid-for-me is recorded but never proposed', async () => {
      await linkAliceAndBob();
      const categories = await request(server())
        .get(`/api/ledgers/${alice.ledgerId}/categories`)
        .query({ type: 'EXPENSE' })
        .set(auth(alice.token));
      const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;

      const res = await post(alice, {
        counterparty: { id: aliceSide },
        kind: 'PAID_FOR_ME',
        amount: 300,
        record: { ledgerId: alice.ledgerId },
        categoryId,
      });
      expect(res.status).toBe(201);
      expect(await proposals(app, bob, 'incoming')).toHaveLength(0);
      expect((await entries(alice, aliceSide))[0]!.sync).toBe('NONE');
    });
  });
});
