import { INestApplication } from '@nestjs/common';
import type { Account, Friend, Paginated } from '@ledger/shared';
import request from 'supertest';
import { orderPair } from '../src/friends/friendship';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * SC-F10（SEC-19）：好友關係不擴張任何資源權限。
 *
 * ⚠️ 協調者先寫的驗收門檻（SEC-10），worker 不准修改。
 *
 * 策略：好友關係**直接寫進資料庫**，不經過好友邀請的端點。這樣測的只有「好友關係存在時，
 * 既有的帳本／帳戶／交易端點會不會因此放行」，與邀請流程的實作無關。
 *
 * 每組都有「應該可以」的對照組：A 讀自己的帳本、A 讀被明確加入的共享帳本。少了對照組，
 * 「一律 404」也可能只是整個 app 壞了。
 */
describe('Friends do not widen access (SEC-19, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function befriend(a: string, b: string): Promise<void> {
    await prisma.friendship.create({ data: orderPair(a, b) });
  }

  async function setupFriends() {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    await befriend(alice.userId, bob.userId);
    return { alice, bob };
  }

  it('control: a user reads their own ledger, and a shared ledger they were added to', async () => {
    const { alice, bob } = await setupFriends();

    const own = await request(server())
      .get(`/api/ledgers/${await firstLedgerId(app, alice.token)}`)
      .set(auth(alice.token));
    expect(own.status).toBe(200);

    const shared = await createSharedLedger(app, bob.token, 'Bob & Alice');
    await request(server())
      .post(`/api/ledgers/${shared}/members`)
      .set(auth(bob.token))
      .send({ email: 'alice@example.com', role: 'VIEWER' })
      .expect(201);
    const added = await request(server()).get(`/api/ledgers/${shared}`).set(auth(alice.token));
    expect(added.status).toBe(200);
  });

  it("a friend cannot read the other's ledger, transactions or members", async () => {
    const { alice, bob } = await setupFriends();
    const bobsPersonal = await firstLedgerId(app, bob.token);
    const bobsShared = await createSharedLedger(app, bob.token, 'Bob only');

    for (const ledgerId of [bobsPersonal, bobsShared]) {
      for (const path of ['', '/transactions', '/members', '/categories']) {
        const res = await request(server())
          .get(`/api/ledgers/${ledgerId}${path}`)
          .set(auth(alice.token));
        expect({ path, status: res.status }).toEqual({ path, status: 404 });
      }
    }
  });

  it("a friend cannot add themselves or anyone to the other's shared ledger", async () => {
    const { alice, bob } = await setupFriends();
    const bobsShared = await createSharedLedger(app, bob.token, 'Bob only');

    const res = await request(server())
      .post(`/api/ledgers/${bobsShared}/members`)
      .set(auth(alice.token))
      .send({ email: 'alice@example.com', role: 'EDITOR' });
    expect(res.status).toBe(404);

    const members = await prisma.ledgerMember.count({ where: { ledgerId: bobsShared } });
    expect(members).toBe(1);
  });

  it("a friend's account list does not include the other's accounts", async () => {
    const { alice, bob } = await setupFriends();
    const bobsAccountIds = (await request(server()).get('/api/accounts').set(auth(bob.token)))
      .body as Account[];
    expect(bobsAccountIds.length).toBeGreaterThan(0);

    const alicesAccounts = (await request(server()).get('/api/accounts').set(auth(alice.token)))
      .body as Account[];
    const leaked = alicesAccounts.filter((account) =>
      bobsAccountIds.some((bobs) => bobs.id === account.id),
    );
    expect(leaked).toEqual([]);
  });

  // 好友的好友不是我的好友：A–B、B–C 是好友，A 的清單只有 B。
  it("a friend's other friends do not appear in my friend list", async () => {
    const { alice, bob } = await setupFriends();
    const carol = await registerAndLogin(app, 'carol@example.com', 'Carol');
    await befriend(bob.userId, carol.userId);

    const res = await request(server()).get('/api/friends').set(auth(alice.token));
    expect(res.status).toBe(200);
    const ids = (res.body as Paginated<Friend>).items.map((friend) => friend.userId);
    expect(ids).toEqual([bob.userId]);
  });
});
