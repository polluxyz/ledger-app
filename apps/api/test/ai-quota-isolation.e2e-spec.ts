import { HttpStatus, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@ledger/shared';
import request from 'supertest';
import { AppException } from '../src/common/exceptions/app.exception';
import { AI_QUOTA_LIMITS, type AiQuotaLimits } from '../src/ai/ai-quota.tokens';
import {
  LLM_PROVIDER,
  type LLMProvider,
  type LlmProviderDescriptor,
  type LlmResponse,
} from '../src/ai/llm-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 4a 每日額度的隔離與「算／不算」（spec `phase-4a-ai-quota.md` SC-P18 第 1～3 項、
 * SC-P19 第 2 項、SC-P21 第 1 項）。協調者在實作前寫好，先看到紅燈。
 *
 * - 個人額度以使用者計，不以帳本或 token 計：2 本帳本合計、換一個 token 仍被擋，
 *   另一個人的額度不受影響。
 * - 被全站上限擋下的那次不扣個人次數（兩邊在同一個資料庫交易裡扣，原子）。
 * - 權限 403、別人的帳本 404、空白句子 400、AI 沒設定、每分鐘限流 → 兩張表都沒有變化。
 *   每條配一個正向對照：被拒絕後，同一個人送合法請求仍是 200，provider 有被呼叫。
 *
 * 策略：provider 與上限都由測試注入。`limits` 是同一個可變物件，每個測試自己改數字，
 * 所以實作必須每次呼叫都重新讀上限，不可快取。兩張表還沒有 Prisma model，
 * 一律用 `$queryRaw` 查；T0 時表不存在，這些斷言預期紅，T1 後轉綠。
 * 正向對照只斷言 HTTP 結果與 provider 呼叫，不查表，T0 就該綠。
 *
 * 場景：Bob 是使用者。Carol 擁有共享帳本「公司聚餐」，Bob 是 VIEWER。Eve 和 Bob 沒有共同帳本。
 */
describe('AI parse daily quota — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const complete = jest.fn<Promise<LlmResponse>, Parameters<LLMProvider['complete']>>();
  const descriptor: LlmProviderDescriptor = { configured: true, provider: 'stub', model: null };
  const stub: LLMProvider = { descriptor, complete };
  const DEFAULT_LIMITS: AiQuotaLimits = {
    perUserDaily: 50,
    globalDaily: 500,
    maxOutputTokens: 2048,
  };
  const limits: AiQuotaLimits = { ...DEFAULT_LIMITS };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp((builder) =>
      builder
        .overrideProvider(LLM_PROVIDER)
        .useValue(stub)
        .overrideProvider(AI_QUOTA_LIMITS)
        .useValue(limits),
    ));
  });
  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    await resetDb(prisma);
    Object.assign(limits, DEFAULT_LIMITS);
    descriptor.configured = true;
    complete.mockReset();
    complete.mockResolvedValue({ truncated: false, content: { drafts: [] } });
  });
  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  });

  const server = () => httpServer(app);
  const TODAY = '2026-10-24';
  const TEXT = '早餐 60';

  function parse(token: string, ledgerId: string, text = TEXT) {
    return request(server())
      .post('/api/ai/parse-transaction')
      .set(auth(token))
      .send({ text, ledgerId, today: TODAY });
  }

  /** 某人在個人表裡所有日子的次數合計；沒有列就是 0。 */
  async function userCalls(userId: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ calls: number }[]>`
      SELECT coalesce(sum("calls"), 0)::int AS "calls"
      FROM "AiParseDailyUsage" WHERE "userId" = ${userId}`;
    return rows[0]!.calls;
  }

  async function globalCalls(): Promise<number> {
    const rows = await prisma.$queryRaw<{ calls: number }[]>`
      SELECT coalesce(sum("calls"), 0)::int AS "calls" FROM "AiDailyUsage"`;
    return rows[0]!.calls;
  }

  /** 兩張表的完整內容（含 updatedAt），用來斷言「完全沒有變化」。 */
  async function snapshot(): Promise<{ users: string; global: string }> {
    const rows = await prisma.$queryRaw<{ users: string; global: string }[]>`
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u."userId", u."day"), '[]'::jsonb)
           FROM "AiParseDailyUsage" u)::text AS "users",
        (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g."day"), '[]'::jsonb)
           FROM "AiDailyUsage" g)::text AS "global"`;
    return rows[0]!;
  }

  async function viewerLedger(bob: Person, carol: Person): Promise<string> {
    const ledgerId = await createSharedLedger(app, carol.token, '公司聚餐');
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(carol.token))
      .send({ email: bob.email, role: 'VIEWER' })
      .expect(201);
    return ledgerId;
  }

  describe('SC-P18: personal limit is per user', () => {
    it('1: the third call is 429 AI_DAILY_LIMIT and the provider ran only twice', async () => {
      limits.perUserDaily = 2;
      const bob = await person(app, 'bob@example.com', 'Bob');
      await parse(bob.token, bob.ledgerId).expect(200);
      await parse(bob.token, bob.ledgerId).expect(200);
      const res = await parse(bob.token, bob.ledgerId).expect(429);
      expect(res.body).toMatchObject({ errorCode: ErrorCode.AI_DAILY_LIMIT });
      expect(complete).toHaveBeenCalledTimes(2);
      expect(await userCalls(bob.userId)).toBe(2);
    });

    it('2: two ledgers count together, and a fresh token is still blocked', async () => {
      limits.perUserDaily = 2;
      const bob = await person(app, 'bob@example.com', 'Bob');
      const tripId = await createSharedLedger(app, bob.token, '旅行');
      await parse(bob.token, bob.ledgerId).expect(200);
      await parse(bob.token, tripId).expect(200);

      const freshToken = await app
        .get(JwtService)
        .signAsync({ sub: bob.userId, email: bob.email }, { expiresIn: '1h' });
      expect(freshToken).not.toBe(bob.token);
      const res = await parse(freshToken, tripId).expect(429);
      expect(res.body).toMatchObject({ errorCode: ErrorCode.AI_DAILY_LIMIT });
      expect(complete).toHaveBeenCalledTimes(2);
      expect(await userCalls(bob.userId)).toBe(2);
    });

    it('3: another user is unaffected', async () => {
      limits.perUserDaily = 2;
      const bob = await person(app, 'bob@example.com', 'Bob');
      const eve = await person(app, 'eve@example.com', 'Eve');
      await parse(bob.token, bob.ledgerId).expect(200);
      await parse(bob.token, bob.ledgerId).expect(200);
      await parse(bob.token, bob.ledgerId).expect(429);

      await parse(eve.token, eve.ledgerId).expect(200);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(await userCalls(bob.userId)).toBe(2);
      expect(await userCalls(eve.userId)).toBe(1);
    });
  });

  describe('SC-P19: the global limit does not touch personal counts', () => {
    it('2: B blocked by the global limit keeps B at one personal call', async () => {
      limits.perUserDaily = 10;
      limits.globalDaily = 3;
      const alice = await person(app, 'alice@example.com', 'Alice');
      const bob = await person(app, 'bob@example.com', 'Bob');
      await parse(alice.token, alice.ledgerId).expect(200);
      await parse(alice.token, alice.ledgerId).expect(200);
      await parse(bob.token, bob.ledgerId).expect(200);

      const res = await parse(bob.token, bob.ledgerId).expect(503);
      expect(res.body).toMatchObject({ errorCode: ErrorCode.AI_UNAVAILABLE });
      expect(complete).toHaveBeenCalledTimes(3);
      expect(await userCalls(alice.userId)).toBe(2);
      expect(await userCalls(bob.userId)).toBe(1);
      expect(await globalCalls()).toBe(3);
    });
  });

  /**
   * SC-P21 第 1 項的每種拒絕。`reject` 送出會被拒絕的請求並斷言狀態碼；
   * `legal` 是同一個人換成合法的請求。
   */
  interface RejectionCase {
    name: string;
    reject: (bob: Person) => Promise<void>;
    legal: (bob: Person) => Promise<void>;
  }

  const legalOwnLedger = async (bob: Person) => {
    descriptor.configured = true;
    await parse(bob.token, bob.ledgerId).expect(200);
  };

  const REJECTIONS: RejectionCase[] = [
    {
      name: 'viewer ledger 403',
      reject: async (bob) => {
        const carol = await person(app, 'carol@example.com', 'Carol');
        await parse(bob.token, await viewerLedger(bob, carol)).expect(403);
      },
      legal: legalOwnLedger,
    },
    {
      name: "someone else's ledger 404",
      reject: async (bob) => {
        const eve = await person(app, 'eve@example.com', 'Eve');
        await parse(bob.token, eve.ledgerId).expect(404);
      },
      legal: legalOwnLedger,
    },
    {
      name: 'blank sentence 400',
      reject: async (bob) => {
        await parse(bob.token, bob.ledgerId, '   ').expect(400);
      },
      legal: legalOwnLedger,
    },
    {
      name: 'AI_NOT_CONFIGURED 503',
      reject: async (bob) => {
        descriptor.configured = false;
        complete.mockRejectedValueOnce(
          new AppException(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.AI_NOT_CONFIGURED,
            'AI is not configured.',
          ),
        );
        const res = await parse(bob.token, bob.ledgerId).expect(503);
        expect(res.body).toMatchObject({ errorCode: ErrorCode.AI_NOT_CONFIGURED });
      },
      legal: legalOwnLedger,
    },
  ];

  describe('SC-P21: rejected requests leave both tables unchanged', () => {
    it.each(REJECTIONS)('$name', async ({ reject }) => {
      const bob = await person(app, 'bob@example.com', 'Bob');
      // 先成功一次，兩張表都有列，「沒有變化」才有意義。
      await parse(bob.token, bob.ledgerId).expect(200);
      const before = await snapshot();
      await reject(bob);
      expect(await snapshot()).toEqual(before);
      expect(await userCalls(bob.userId)).toBe(1);
    });

    it('per-minute throttle 429', async () => {
      const bob = await person(app, 'bob@example.com', 'Bob');
      process.env.NODE_ENV = 'ai-throttle-test';
      for (let index = 0; index < 10; index += 1) {
        await parse(bob.token, bob.ledgerId).expect(200);
      }
      const before = await snapshot();
      const res = await parse(bob.token, bob.ledgerId).expect(429);
      expect(res.body).toMatchObject({ errorCode: ErrorCode.TOO_MANY_REQUESTS });
      expect(await snapshot()).toEqual(before);
      expect(await userCalls(bob.userId)).toBe(10);
    });
  });

  describe('SC-P21 positive controls: the same person can still parse', () => {
    it.each(REJECTIONS)('after $name', async ({ reject, legal }) => {
      const bob = await person(app, 'bob@example.com', 'Bob');
      await reject(bob);
      // mockReset 連沒用到的 Once 一起清掉：實作在 complete 之前就擋下 AI_NOT_CONFIGURED 時，
      // 那個 Once 不會被消耗。
      complete.mockReset();
      complete.mockResolvedValue({ truncated: false, content: { drafts: [] } });
      await legal(bob);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('under the per-minute throttle', async () => {
      const bob = await person(app, 'bob@example.com', 'Bob');
      process.env.NODE_ENV = 'ai-throttle-test';
      for (let index = 0; index < 10; index += 1) {
        await parse(bob.token, bob.ledgerId).expect(200);
      }
      expect(complete).toHaveBeenCalledTimes(10);
      const res = await parse(bob.token, bob.ledgerId).expect(429);
      expect(res.body).toMatchObject({ errorCode: ErrorCode.TOO_MANY_REQUESTS });
      expect(complete).toHaveBeenCalledTimes(10);
    });
  });
});
