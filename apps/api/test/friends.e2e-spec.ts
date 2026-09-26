import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type {
  Friend,
  FriendInviteLinkCreated,
  FriendInviteLinkPreview,
  FriendRequest,
  LinkAccepted,
  Paginated,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/**
 * 好友系統的端對端流程：email 邀請（SC-F1～F5）、邀請連結（SC-F7、F8）、解除好友（SC-F9）、
 * 回應不含 email（SC-F11）。
 *
 * ⚠️ 協調者先寫的驗收門檻，worker 不准修改。
 *
 * 時間相關的情境（連結過期）不等真的 10 分鐘：直接把資料庫裡的 `expiresAt` 改到過去。
 */
describe('Friends (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function users() {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    return { alice, bob };
  }

  function invite(token: string, email: string) {
    return request(server()).post('/api/friend-requests').set(auth(token)).send({ email });
  }

  async function friendsOf(token: string): Promise<Friend[]> {
    const res = await request(server()).get('/api/friends').set(auth(token));
    expect(res.status).toBe(200);
    return (res.body as Paginated<Friend>).items;
  }

  async function requestsOf(token: string, direction: 'incoming' | 'outgoing') {
    const res = await request(server())
      .get('/api/friend-requests')
      .query({ direction })
      .set(auth(token));
    expect(res.status).toBe(200);
    return (res.body as Paginated<FriendRequest>).items;
  }

  describe('email invitations', () => {
    // SC-F1
    it('invite → shows up as incoming → accept → both see each other', async () => {
      const { alice, bob } = await users();

      const sent = await invite(alice.token, 'bob@example.com');
      expect(sent.status).toBe(201);
      expect((sent.body as FriendRequest).status).toBe('PENDING');

      const incoming = await requestsOf(bob.token, 'incoming');
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.counterpart).toEqual({
        userId: alice.userId,
        name: 'Alice',
        email: null,
      });

      const accepted = await request(server())
        .post(`/api/friend-requests/${incoming[0]!.id}/accept`)
        .set(auth(bob.token));
      expect(accepted.status).toBe(200);
      expect(accepted.body as LinkAccepted).toMatchObject({
        askMerge: false,
        otherUser: { id: alice.userId, name: 'Alice' },
      });
      expect((await requestsOf(bob.token, 'incoming'))[0]!.status).toBe('ACCEPTED');

      expect((await friendsOf(alice.token)).map((f) => f.userId)).toEqual([bob.userId]);
      expect((await friendsOf(bob.token)).map((f) => f.userId)).toEqual([alice.userId]);
    });

    // SC-F2
    it('an unregistered email → 404 USER_NOT_FOUND and nothing is stored', async () => {
      const { alice } = await users();
      const res = await invite(alice.token, 'ghost@example.com');
      expect(res.status).toBe(404);
      expect((res.body as { errorCode: string }).errorCode).toBe('USER_NOT_FOUND');
      expect(await prisma.friendRequest.count()).toBe(0);
    });

    it('matches the email regardless of case', async () => {
      const { alice } = await users();
      const res = await invite(alice.token, 'Bob@Example.com');
      expect(res.status).toBe(201);
    });

    // SC-F3
    it('rejects inviting yourself, an existing friend, or a duplicate pending invite', async () => {
      const { alice, bob } = await users();

      const self = await invite(alice.token, 'alice@example.com');
      expect(self.status).toBe(400);
      expect((self.body as { errorCode: string }).errorCode).toBe('CANNOT_FRIEND_SELF');

      await invite(alice.token, 'bob@example.com').expect(201);
      const duplicate = await invite(alice.token, 'bob@example.com');
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as { errorCode: string }).errorCode).toBe('FRIEND_REQUEST_PENDING');

      const [pending] = await requestsOf(bob.token, 'incoming');
      await request(server())
        .post(`/api/friend-requests/${pending!.id}/accept`)
        .set(auth(bob.token))
        .expect(200);
      const already = await invite(alice.token, 'bob@example.com');
      expect(already.status).toBe(409);
      expect((already.body as { errorCode: string }).errorCode).toBe('ALREADY_LINKED');
    });

    // SC-F4
    it('points to the reverse pending invite for explicit acceptance', async () => {
      const { alice, bob } = await users();
      await invite(bob.token, 'alice@example.com').expect(201);

      const res = await invite(alice.token, 'bob@example.com');
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('LINK_INVITE_FROM_THEM');

      expect(await prisma.friendRequest.count()).toBe(1);
      expect(await friendsOf(alice.token)).toHaveLength(0);
      const [pending] = await requestsOf(alice.token, 'incoming');
      await request(server())
        .post(`/api/friend-requests/${pending!.id}/accept`)
        .set(auth(alice.token))
        .expect(200);
      expect((await friendsOf(alice.token)).map((f) => f.userId)).toEqual([bob.userId]);
    });

    it('links people who were already friends before this revision', async () => {
      const { alice, bob } = await users();
      const [userLowId, userHighId] = [alice.userId, bob.userId].sort() as [string, string];
      await prisma.friendship.create({ data: { userLowId, userHighId } });
      await invite(alice.token, 'bob@example.com').expect(201);
      const [pending] = await requestsOf(bob.token, 'incoming');
      await request(server())
        .post(`/api/friend-requests/${pending!.id}/accept`)
        .set(auth(bob.token))
        .expect(200);
      expect(await prisma.friendship.count()).toBe(1);
      expect(await prisma.counterpartyLink.count()).toBe(1);
    });

    // SC-F5（開發者定案：不設冷卻期）
    it('after a decline the requester sees DECLINED and can re-send right away', async () => {
      const { alice, bob } = await users();
      await invite(alice.token, 'bob@example.com').expect(201);
      const [pending] = await requestsOf(bob.token, 'incoming');
      await request(server())
        .post(`/api/friend-requests/${pending!.id}/decline`)
        .set(auth(bob.token))
        .expect(200);

      const outgoing = await requestsOf(alice.token, 'outgoing');
      expect(outgoing.map((r) => r.status)).toEqual(['DECLINED']);

      const again = await invite(alice.token, 'bob@example.com');
      expect(again.status).toBe(201);
      expect((again.body as FriendRequest).status).toBe('PENDING');
    });

    // SC-F11（決策 11）：送出、尚未接受的邀請只帶我輸入的 email，不帶對方名稱。
    it('an outgoing pending request shows only the email I typed', async () => {
      const { alice } = await users();
      await invite(alice.token, 'bob@example.com').expect(201);
      const [outgoing] = await requestsOf(alice.token, 'outgoing');
      expect(outgoing!.counterpart).toEqual({ userId: null, name: null, email: 'bob@example.com' });
    });

    it('the recipient cannot cancel and the requester cannot accept', async () => {
      const { alice, bob } = await users();
      const sent = (await invite(alice.token, 'bob@example.com')).body as FriendRequest;

      await request(server())
        .post(`/api/friend-requests/${sent.id}/cancel`)
        .set(auth(bob.token))
        .expect(403);
      await request(server())
        .post(`/api/friend-requests/${sent.id}/accept`)
        .set(auth(alice.token))
        .expect(403);

      const carol = await registerAndLogin(app, 'carol@example.com', 'Carol');
      await request(server())
        .post(`/api/friend-requests/${sent.id}/accept`)
        .set(auth(carol.token))
        .expect(404);
    });
  });

  describe('invite links', () => {
    async function createLink(token: string): Promise<FriendInviteLinkCreated> {
      const res = await request(server()).post('/api/friend-invite-links').set(auth(token));
      expect(res.status).toBe(201);
      return res.body as FriendInviteLinkCreated;
    }

    function acceptLink(token: string, linkToken: string) {
      return request(server())
        .post('/api/friend-invite-links/accept')
        .set(auth(token))
        .send({ token: linkToken });
    }

    function expectInvalid(res: request.Response) {
      expect(res.status).toBe(404);
      expect((res.body as { errorCode: string }).errorCode).toBe('INVITE_LINK_INVALID');
    }

    // SC-F7
    it('create → preview shows the inviter → accept → friends; the link then stops working', async () => {
      const { alice, bob } = await users();
      const link = await createLink(alice.token);

      const preview = await request(server())
        .post('/api/friend-invite-links/preview')
        .set(auth(bob.token))
        .send({ token: link.token });
      expect(preview.status).toBe(200);
      expect((preview.body as FriendInviteLinkPreview).inviterName).toBe('Alice');

      const accepted = await acceptLink(bob.token, link.token);
      expect(accepted.status).toBe(201);
      expect(accepted.body as LinkAccepted).toMatchObject({
        counterpartyId: expect.any(String) as unknown,
        askMerge: false,
        otherUser: { id: alice.userId, name: 'Alice' },
      });
      expect((await friendsOf(alice.token)).map((f) => f.userId)).toEqual([bob.userId]);

      const carol = await registerAndLogin(app, 'carol@example.com', 'Carol');
      expectInvalid(await acceptLink(carol.token, link.token));
    });

    it('an expired link is invalid', async () => {
      const { alice, bob } = await users();
      const link = await createLink(alice.token);
      await prisma.friendInviteLink.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expectInvalid(await acceptLink(bob.token, link.token));
    });

    it('creating a new link invalidates the previous unused one', async () => {
      const { alice, bob } = await users();
      const first = await createLink(alice.token);
      await createLink(alice.token);
      expectInvalid(await acceptLink(bob.token, first.token));
    });

    it('you cannot accept your own link', async () => {
      const { alice } = await users();
      const link = await createLink(alice.token);
      const res = await acceptLink(alice.token, link.token);
      expect(res.status).toBe(400);
      expect((res.body as { errorCode: string }).errorCode).toBe('CANNOT_FRIEND_SELF');
    });

    it('accepting while already friends → 409 and the link is not consumed', async () => {
      const { alice, bob } = await users();
      await acceptLink(bob.token, (await createLink(alice.token)).token).expect(201);

      const link = await createLink(alice.token);
      const again = await acceptLink(bob.token, link.token);
      expect(again.status).toBe(409);

      const carol = await registerAndLogin(app, 'carol@example.com', 'Carol');
      expect((await acceptLink(carol.token, link.token)).status).toBe(201);
    });

    it('an invitation URL links existing friends without adding another friendship', async () => {
      const { alice, bob } = await users();
      const [userLowId, userHighId] = [alice.userId, bob.userId].sort() as [string, string];
      await prisma.friendship.create({ data: { userLowId, userHighId } });
      const link = await createLink(alice.token);
      await acceptLink(bob.token, link.token).expect(201);
      expect(await prisma.friendship.count()).toBe(1);
      expect(await prisma.counterpartyLink.count()).toBe(1);
    });

    it('an unknown token is invalid, and a malformed one is rejected by validation', async () => {
      const { bob } = await users();
      expectInvalid(await acceptLink(bob.token, 'A'.repeat(43)));
      expect((await acceptLink(bob.token, 'short')).status).toBe(400);
    });

    // SC-F8
    it('stores only the SHA-256 of the token, never the token itself', async () => {
      const { alice } = await users();
      const link = await createLink(alice.token);

      const rows = await prisma.friendInviteLink.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(link.token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(link.token);
    });

    it('the link expires 10 minutes after creation', async () => {
      const { alice } = await users();
      const before = Date.now();
      const link = await createLink(alice.token);
      const ttl = new Date(link.expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThan(9 * 60_000);
      expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    });
  });

  describe('friend list and unfriending', () => {
    async function makeFriends(a: { token: string }, bEmail: string, b: { token: string }) {
      await invite(a.token, bEmail).expect(201);
      const [pending] = await requestsOf(b.token, 'incoming');
      await request(server())
        .post(`/api/friend-requests/${pending!.id}/accept`)
        .set(auth(b.token))
        .expect(200);
    }

    // SC-F11
    it('the friend list carries only userId, name and since', async () => {
      const { alice, bob } = await users();
      await makeFriends(alice, 'bob@example.com', bob);
      const [friend] = await friendsOf(alice.token);
      expect(Object.keys(friend!).sort()).toEqual(['name', 'since', 'userId']);
    });

    // SC-F9
    it('unfriending is one-sided, removes both views, and allows re-inviting', async () => {
      const { alice, bob } = await users();
      await makeFriends(alice, 'bob@example.com', bob);

      await request(server())
        .delete(`/api/friends/${alice.userId}`)
        .set(auth(bob.token))
        .expect(204);
      expect(await friendsOf(alice.token)).toEqual([]);
      expect(await friendsOf(bob.token)).toEqual([]);

      await request(server())
        .delete(`/api/friends/${alice.userId}`)
        .set(auth(bob.token))
        .expect(404);

      expect((await invite(alice.token, 'bob@example.com')).status).toBe(201);
    });
  });
});
