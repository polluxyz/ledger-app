import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Category } from '@ledger/shared';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  httpServer,
  idempotencyKey,
  loginAgain,
  resetDb,
  signRawToken,
} from './e2e-utils';
import { auth, DAY, person, type Person } from './linking-utils';

/**
 * R6 登出讓憑證失效：協調者先寫、先紅的授權與隔離測試（spec SC-TV1、2、5、6，SEC-10）。
 *
 * 這 4 條是「拿到憑證不等於能用」的防線：
 * - SC-TV1：登出後同一張憑證立刻 401。
 * - SC-TV2：同一人有 2 筆登入，登出其中 1 筆不影響另一筆。
 * - SC-TV5：用正確密鑰偽造「別人的 sid」也進不來。
 * - SC-TV6：缺 sid（部署前的舊憑證）、缺 exp、型別不符、指向不存在的紀錄，一律 401。
 *
 * 策略：真的起應用程式、打真的 HTTP、連真的測試資料庫。能用的憑證一律走真登入；
 * 只有 SC-TV5、SC-TV6 的「壞憑證」用 `signRawToken` 簽（決策 384 (c)）。
 * 每條「被拒絕」都同時斷言狀態碼與回應沒有帶出使用者資料（spec §5 開頭）。
 *
 * 紅綠：T0 時沒有登出端點（SC-TV1、2 在登出那步拿到 404），guard 只驗簽章
 * （SC-TV5、6 會放行）。T1 完成後轉綠，斷言不改。
 */
describe('Auth session isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);

  /** 1 小時後的 `exp`（秒）。讓壞憑證只壞在要測的那一項，不是因為過期被擋。 */
  const inOneHour = () => Math.floor(Date.now() / 1000) + 60 * 60;

  /** 從真登入拿到的憑證解出 `sid`。只解碼不驗證，用來組偽造的憑證。 */
  function sidOf(token: string): string {
    const decoded: unknown = new JwtService().decode(token);
    const sid = (decoded as { sid?: unknown } | null)?.sid;
    if (typeof sid !== 'string' || sid === '') {
      throw new Error('login token has no sid');
    }
    return sid;
  }

  function getMe(token: string) {
    return request(server()).get('/api/users/me').set(auth(token));
  }

  function logout(token: string) {
    return request(server()).post('/api/auth/logout').set(auth(token));
  }

  /** 被拒絕的回應不能帶出任何一位使用者的 email 或 id。 */
  function expectNoUserData(res: Response, ...people: Person[]): void {
    const body = JSON.stringify(res.body);
    for (const who of people) {
      expect(body).not.toContain(who.email);
      expect(body).not.toContain(who.userId);
    }
  }

  async function expenseCategoryId(who: Person): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${who.ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  describe('SC-TV1 logout revokes the token', () => {
    it('returns 401 for the same token after logout, without user data', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');

      const before = await getMe(alice.token).expect(200);
      expect((before.body as { email: string }).email).toBe(alice.email);

      await logout(alice.token).expect(204);

      const after = await getMe(alice.token).expect(401);
      expectNoUserData(after, alice);
    });
  });

  describe('SC-TV2 logins are independent', () => {
    it('revokes only the logged-out login; the other can still read and write', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const tokenA = alice.token;
      const tokenB = await loginAgain(app, alice.email);
      expect(tokenB).not.toBe(tokenA);

      await logout(tokenA).expect(204);

      const rejected = await getMe(tokenA).expect(401);
      expectNoUserData(rejected, alice);

      const me = await getMe(tokenB).expect(200);
      expect((me.body as { email: string }).email).toBe(alice.email);

      const categoryId = await expenseCategoryId({ ...alice, token: tokenB });
      const countBefore = await prisma.transaction.count();
      await request(server())
        .post(`/api/ledgers/${alice.ledgerId}/transactions`)
        .set(auth(tokenB))
        .set(idempotencyKey())
        .send({ type: 'EXPENSE', date: DAY, accountId: alice.cashId, amount: 120, categoryId })
        .expect(201);
      expect(await prisma.transaction.count()).toBe(countBefore + 1);
    });
  });

  describe('SC-TV5 cross-user sid', () => {
    it("rejects B's identity on A's sid and leaves A's login usable", async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');

      const forged = await signRawToken(app, {
        sub: bob.userId,
        email: bob.email,
        sid: sidOf(alice.token),
        exp: inOneHour(),
      });

      const res = await getMe(forged).expect(401);
      expectNoUserData(res, alice, bob);

      // A 的登入沒有被這次偽造牽連。
      expect(
        (await prisma.authSession.findUniqueOrThrow({ where: { id: sidOf(alice.token) } }))
          .revokedAt,
      ).toBeNull();
      await getMe(alice.token).expect(200);
    });
  });

  describe('SC-TV6 malformed and legacy tokens', () => {
    type Build = (alice: Person) => Record<string, unknown>;

    const cases: Array<[string, Build]> = [
      [
        'no sid (a token issued before R6)',
        (alice) => ({ sub: alice.userId, email: alice.email, exp: inOneHour() }),
      ],
      ['no exp', (alice) => ({ sub: alice.userId, email: alice.email, sid: sidOf(alice.token) })],
      [
        'sid is not a string',
        (alice) => ({ sub: alice.userId, email: alice.email, sid: 123, exp: inOneHour() }),
      ],
      [
        'sid is an empty string',
        (alice) => ({ sub: alice.userId, email: alice.email, sid: '', exp: inOneHour() }),
      ],
      [
        'sub is not a string',
        (alice) => ({ sub: 123, email: alice.email, sid: sidOf(alice.token), exp: inOneHour() }),
      ],
      [
        'sub is an empty string',
        (alice) => ({ sub: '', email: alice.email, sid: sidOf(alice.token), exp: inOneHour() }),
      ],
      [
        'sid points to no login record',
        (alice) => ({ sub: alice.userId, email: alice.email, sid: randomUUID(), exp: inOneHour() }),
      ],
    ];

    it.each(cases)('rejects a token with %s', async (_label, build) => {
      const alice = await person(app, 'alice@example.com', 'Alice');

      const token = await signRawToken(app, build(alice));

      const res = await getMe(token).expect(401);
      expectNoUserData(res, alice);
    });
  });
});
