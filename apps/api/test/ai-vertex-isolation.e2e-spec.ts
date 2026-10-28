import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { VERTEX_TOKEN_SOURCE, type AccessTokenSource } from '../src/ai/access-token-source';
import { AI_CLOCK, AI_QUOTA_LIMITS } from '../src/ai/ai-quota.tokens';
import type { Env } from '../src/config/env.validation';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

const PROJECT = 'aiv-e2e-project';
const MODEL = 'deepseek-ai/deepseek-v4.1-flash-maas';
// 決策 339 (e)：網址寫死在程式裡，只有專案 id 來自設定。
const VERTEX_URL = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/endpoints/openapi/chat/completions`;
// 三個特殊字串只會出現在假的認證來源裡；在任何輸出看到它們就是外洩。
const TOKEN = 'ya29.AIV_TOKEN_SENTINEL_5c1e';
const KEY_PATH = 'C:/secrets/AIV_KEYPATH_SENTINEL_9d2f.json';
const EMAIL = 'aiv-sentinel-7a3b@aiv-e2e-project.iam.gserviceaccount.com';
const SENTINELS = [TOKEN, KEY_PATH, EMAIL];

/**
 * SC-P38、SC-P39：`LLM_PROVIDER=vertex` 時，拿不到 token 與憑證不外洩。
 *
 * 策略：不覆寫 `LLM_PROVIDER`，讓 module 自己的 factory 依覆寫後的 `ConfigService` 建 provider，
 * 這樣驗到的是正式的組裝路徑。認證來源換成可變的 mock；`fetch` 在建 app 之前就攔下，
 * 因為 provider 建構時會記住當下的 fetch。整份測試不連 Google。
 *
 * T0 時 factory 還不認得 `vertex`，Vertex 的斷言預期是紅的；`fake` 的正向對照要綠，
 * 用來證明紅燈來自 factory，不是測試本身的組裝。
 */
describe('AI Vertex provider isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bob: Person;
  const getAccessToken = jest.fn<Promise<string>, []>();
  const tokenSource: AccessTokenSource = { getAccessToken };
  const today = '2040-03-01';
  let fetchSpy: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>;

  /** 依 `LLM_PROVIDER` 建一個獨立的 app。額度上限直接給數字，避免從原始 env 讀到字串。 */
  function buildApp(provider: 'vertex' | 'fake') {
    const config = new ConfigService<Env, true>({
      ...process.env,
      JWT_EXPIRES_IN: '7d',
      LLM_PROVIDER: provider,
      VERTEX_PROJECT_ID: PROJECT,
      VERTEX_LOCATION: 'global',
      VERTEX_MODEL: MODEL,
    });
    return createE2EApp((builder) =>
      builder
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(VERTEX_TOKEN_SOURCE)
        .useValue(tokenSource)
        .overrideProvider(AI_QUOTA_LIMITS)
        .useValue({ perUserDaily: 50, globalDaily: 500, maxOutputTokens: 2048 })
        // 固定額度日期，避免測試跨過台灣午夜而拆成兩列。
        .overrideProvider(AI_CLOCK)
        .useValue(() => new Date('2026-10-28T12:00:00Z')),
    );
  }

  /** 模型回一個合法但沒有草稿的 chat completion，附 usage。 */
  function completion(): Response {
    return new Response(
      JSON.stringify({
        choices: [
          { message: { role: 'assistant', content: '{"drafts":[]}' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  beforeAll(async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(completion()));
    ({ app, prisma } = await buildApp('vertex'));
  });
  beforeEach(async () => {
    await resetDb(prisma);
    getAccessToken.mockReset();
    fetchSpy.mockClear();
    bob = await person(app, 'bob@example.com', 'Bob');
  });
  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  function parse(target: INestApplication = app) {
    return request(httpServer(target))
      .post('/api/ai/parse-transaction')
      .set(auth(bob.token))
      .send({ text: '今天天氣很好', ledgerId: bob.ledgerId, today });
  }

  /** 攔下 Nest `Logger`（實例與靜態）與 `console` 的所有輸出。 */
  function captureLogs() {
    const logged: unknown[][] = [];
    const push = (...args: unknown[]) => {
      logged.push(args);
    };
    const spies = [
      ...(['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((method) =>
        jest.spyOn(Logger.prototype, method).mockImplementation(push),
      ),
      ...(['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((method) =>
        jest.spyOn(Logger, method).mockImplementation(push),
      ),
      ...(['log', 'error', 'warn', 'debug', 'info', 'trace'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation(push),
      ),
    ];
    const usageLines = () =>
      logged
        .flat()
        .filter(
          (value): value is string => typeof value === 'string' && value.startsWith('outcome='),
        );
    return { logged, usageLines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  /** 掃所有文字型欄位，回傳含 `needle` 的欄位清單。 */
  async function columnsContaining(needle: string): Promise<string[]> {
    const columns = await prisma.$queryRaw<
      { table_name: string; column_name: string }[]
    >`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')`;
    const hits: string[] = [];
    for (const column of columns) {
      const table = column.table_name.replaceAll('"', '""');
      const field = column.column_name.replaceAll('"', '""');
      const matches = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM ${Prisma.raw(`"${table}"`)}
        WHERE ${Prisma.raw(`"${field}"`)}::text LIKE ${`%${needle}%`}`;
      if (matches[0]!.count > 0n) hits.push(`${column.table_name}.${column.column_name}`);
    }
    return hits;
  }

  it('positive control: the same harness with LLM_PROVIDER=fake parses and records usage', async () => {
    const other = await buildApp('fake');
    try {
      await parse(other.app).expect(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(await prisma.aiParseDailyUsage.findMany()).toEqual([
        expect.objectContaining({ userId: bob.userId, calls: 1 }),
      ]);
    } finally {
      await other.app.close();
    }
  });

  it('SC-P38: token failure returns 503 AI_UNAVAILABLE, counts one unknown-usage call, logs auth, never calls fetch', async () => {
    getAccessToken.mockRejectedValue(new Error('Could not load the default credentials.'));
    const logs = captureLogs();
    try {
      const res = await parse().expect(503);
      expect(res.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
      expect(getAccessToken).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      const personal = await prisma.aiParseDailyUsage.findMany();
      const global = await prisma.aiDailyUsage.findMany();
      expect(personal).toEqual([
        expect.objectContaining({ userId: bob.userId, calls: 1, usageUnknownCalls: 1 }),
      ]);
      expect(global).toEqual([expect.objectContaining({ calls: 1, usageUnknownCalls: 1 })]);
      const lines = logs.usageLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split(' ')[0]).toBe('outcome=auth');
    } finally {
      logs.restore();
    }
  });

  it('SC-P39: token, key path and service-account email never reach responses, logs or tables', async () => {
    const logs = captureLogs();
    try {
      // 成功：token 只該出現在送往 Google 固定網址的 Authorization 標頭。
      getAccessToken.mockResolvedValueOnce(TOKEN);
      const ok = await parse().expect(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(VERTEX_URL);
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);

      // 失敗：套件丟的錯誤訊息帶金鑰路徑與 email，只能被轉成 auth，不可往外傳。
      getAccessToken.mockRejectedValueOnce(
        new Error(`Unable to read ${KEY_PATH}: invalid_grant for ${EMAIL} (token ${TOKEN})`),
      );
      const failed = await parse().expect(503);
      expect(failed.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      expect(logs.usageLines().map((line) => line.split(' ')[0])).toEqual([
        'outcome=empty',
        'outcome=auth',
      ]);
      const outputs = JSON.stringify([
        ok.headers,
        ok.body,
        failed.headers,
        failed.body,
        logs.logged,
      ]);
      for (const sentinel of SENTINELS) {
        expect(outputs).not.toContain(sentinel);
        expect(await columnsContaining(sentinel)).toEqual([]);
      }
    } finally {
      logs.restore();
    }
  });
});
