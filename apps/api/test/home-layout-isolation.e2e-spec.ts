import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 首頁版面的授權與資料隔離（spec `phase-2l-home-layout.md` SC-Y10、SC-Y13）。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - 版面只認 token 裡的使用者：B 讀不到、也改不到 A 的版面；body 帶 `userId` 一律 400。
 * - 未登入的 GET、PUT 都是 401。路徑只接受 `web`。
 * - 刪掉使用者時，他的版面一起刪，別人的不受影響。
 *
 * 策略：資料表 `UserHomeLayout` 還沒有 Prisma model，一律用 `$queryRaw` 查整張表的內容
 * （含 `updatedAt`），用來斷言「完全沒有變化」。兩份版面刻意不同，寫錯人時看得出來。
 *
 * 場景：Alice 與 Bob 是互不相干的兩位使用者。
 */
describe('Home layout — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => httpServer(app);
  const PATH = '/api/users/me/home-layout/web';

  function card(cardId: string) {
    return { type: 'card', cardId };
  }

  /** 預設版面（決策 318）。 */
  const ALICE_LAYOUT = {
    bands: [
      {
        root: {
          type: 'split',
          axis: 'x',
          children: [card('expense'), card('income'), card('net')],
          weights: [3333, 3333, 3334],
        },
        extraHeightPx: 0,
      },
      {
        root: {
          type: 'split',
          axis: 'x',
          children: [card('trend'), card('categories')],
          weights: [6667, 3333],
        },
        extraHeightPx: 0,
      },
      {
        root: {
          type: 'split',
          axis: 'x',
          children: [card('activity'), card('accounts'), card('debts')],
          weights: [3333, 3333, 3334],
        },
        extraHeightPx: 0,
      },
    ],
  };

  /** 8 張卡排成一列，第二列加高：跟 Alice 的版面每一處都不同。 */
  const BOB_LAYOUT = {
    bands: [
      {
        root: {
          type: 'split',
          axis: 'x',
          children: [card('debts'), card('accounts'), card('activity'), card('categories')],
          weights: [2500, 2500, 2500, 2500],
        },
        extraHeightPx: 120,
      },
      {
        root: {
          type: 'split',
          axis: 'x',
          children: [card('trend'), card('net'), card('income'), card('expense')],
          weights: [4000, 2000, 2000, 2000],
        },
        extraHeightPx: 320,
      },
    ],
  };

  function put(token: string, body: Record<string, unknown>) {
    return request(server()).put(PATH).set(auth(token)).send(body);
  }

  function save(token: string, layout: unknown, expectedRevision = 0) {
    return put(token, { schemaVersion: 1, expectedRevision, layout });
  }

  /** 整張表的內容（含 updatedAt），用來斷言「完全沒有變化」。 */
  async function snapshot(): Promise<string> {
    const rows = await prisma.$queryRaw<{ rows: string }[]>`
      SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h."userId", h."surface"), '[]'::jsonb)::text
        AS "rows"
      FROM "UserHomeLayout" h`;
    return rows[0]!.rows;
  }

  async function rowsOf(userId: string): Promise<{ revision: number; layout: unknown }[]> {
    return prisma.$queryRaw<{ revision: number; layout: unknown }[]>`
      SELECT "revision", "layout" FROM "UserHomeLayout" WHERE "userId" = ${userId}`;
  }

  describe('SC-Y10: one user cannot read or change another user layout', () => {
    let alice: Person;
    let bob: Person;

    beforeEach(async () => {
      alice = await person(app, 'alice@example.com', 'Alice');
      bob = await person(app, 'bob@example.com', 'Bob');
      const saved = await save(alice.token, ALICE_LAYOUT).expect(200);
      expect(saved.body).toEqual({ schemaVersion: 1, revision: 1, layout: ALICE_LAYOUT });
    });

    it('1: B reads revision 0 and no layout, and no row is created for B', async () => {
      const res = await request(server()).get(PATH).set(auth(bob.token)).expect(200);
      expect(res.body).toEqual({ schemaVersion: 1, revision: 0, layout: null });
      expect(await rowsOf(bob.userId)).toEqual([]);

      const own = await request(server()).get(PATH).set(auth(alice.token)).expect(200);
      expect(own.body).toEqual({ schemaVersion: 1, revision: 1, layout: ALICE_LAYOUT });
    });

    it('2: B saving its own layout leaves A row untouched', async () => {
      const aliceBefore = await rowsOf(alice.userId);
      const before = await snapshot();

      // B 用 A 的 revision（1）也只會對到 B 自己的列：B 還沒有列，所以是 409，不是改到 A。
      await save(bob.token, BOB_LAYOUT, 1).expect(409);
      expect(await snapshot()).toEqual(before);

      const saved = await save(bob.token, BOB_LAYOUT, 0).expect(200);
      expect(saved.body).toEqual({ schemaVersion: 1, revision: 1, layout: BOB_LAYOUT });
      await save(bob.token, null, 1).expect(200);

      expect(await rowsOf(alice.userId)).toEqual(aliceBefore);
      const aliceView = await request(server()).get(PATH).set(auth(alice.token)).expect(200);
      expect(aliceView.body).toEqual({ schemaVersion: 1, revision: 1, layout: ALICE_LAYOUT });
      expect(await rowsOf(bob.userId)).toEqual([{ revision: 2, layout: null }]);
    });

    it('3: unauthenticated GET and PUT are 401 and change nothing', async () => {
      const before = await snapshot();
      await request(server()).get(PATH).expect(401);
      await request(server())
        .put(PATH)
        .send({ schemaVersion: 1, expectedRevision: 1, layout: BOB_LAYOUT })
        .expect(401);
      await request(server())
        .put(PATH)
        .set(auth('not-a-real-token'))
        .send({ schemaVersion: 1, expectedRevision: 1, layout: BOB_LAYOUT })
        .expect(401);
      expect(await snapshot()).toEqual(before);
    });

    it('4: a body carrying userId is 400 and changes nothing', async () => {
      const before = await snapshot();
      // B 想用自己的 token 改 A 的版面：帶 A 的 userId 與 A 的 revision。
      await put(bob.token, {
        schemaVersion: 1,
        expectedRevision: 1,
        layout: BOB_LAYOUT,
        userId: alice.userId,
      }).expect(400);
      // A 自己帶 userId 也一樣擋：未宣告的鍵一律 400，不是「帶自己的就放行」。
      await put(alice.token, {
        schemaVersion: 1,
        expectedRevision: 1,
        layout: BOB_LAYOUT,
        userId: alice.userId,
      }).expect(400);
      expect(await snapshot()).toEqual(before);
    });

    it('5: only the web surface exists; other paths are 404 and change nothing', async () => {
      const before = await snapshot();
      await request(server()).get('/api/users/me/home-layout/app').set(auth(bob.token)).expect(404);
      await request(server())
        .put('/api/users/me/home-layout/app')
        .set(auth(bob.token))
        .send({ schemaVersion: 1, expectedRevision: 0, layout: BOB_LAYOUT })
        .expect(404);
      await request(server())
        .get(`/api/users/${alice.userId}/home-layout/web`)
        .set(auth(bob.token))
        .expect(404);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('SC-Y13: deleting a user removes that user layout only', () => {
    it('A layout is gone after A is deleted; B layout stays', async () => {
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      await save(alice.token, ALICE_LAYOUT).expect(200);
      await save(bob.token, BOB_LAYOUT).expect(200);
      const bobBefore = await rowsOf(bob.userId);
      expect(bobBefore).toHaveLength(1);

      await prisma.user.delete({ where: { id: alice.userId } });

      expect(await rowsOf(alice.userId)).toEqual([]);
      expect(await rowsOf(bob.userId)).toEqual(bobBefore);
    });
  });
});
