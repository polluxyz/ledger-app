import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ParseTransactionResponse, TransactionDraft } from '@ledger/shared';
import request from 'supertest';
import { VERTEX_TOKEN_SOURCE, type AccessTokenSource } from '../src/ai/access-token-source';
import { AI_CLOCK, AI_QUOTA_LIMITS } from '../src/ai/ai-quota.tokens';
import type { Env } from '../src/config/env.validation';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

const PROJECT = 'aih-e2e-project';
const MODEL = 'claude-haiku-5-5';
// 決策 395 (f)：網址寫死在程式裡，只有專案 id 與模型名來自設定。
const RAW_PREDICT_URL = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/anthropic/models/${MODEL}:rawPredict`;
// 特殊字串只會出現在假的 token 來源與假的 Vertex 回應裡；在任何輸出看到它們就是外洩。
const TOKEN = 'ya29.AIH_TOKEN_SENTINEL_3e8a';
const REFUSAL_TEXT = 'AIH_REFUSAL_TEXT_SENTINEL_61fd';
const REFUSAL_CATEGORY = 'AIH_STOP_DETAILS_SENTINEL_b20c';
const ERROR_BODY = 'AIH_ERROR_BODY_SENTINEL_d47e';
const SENTINELS = [TOKEN, REFUSAL_TEXT, REFUSAL_CATEGORY, ERROR_BODY];

/** 假用量：3 個輸入欄位加總是 120（決策 401），輸出 30。 */
const USAGE = {
  input_tokens: 100,
  output_tokens: 30,
  cache_creation_input_tokens: 15,
  cache_read_input_tokens: 5,
};

/**
 * SC-P45、SC-P48、SC-P49：`LLM_PROVIDER=vertex-anthropic` 時的拒答、不外洩、enum 不取代授權。
 *
 * 策略：照 `ai-vertex-isolation.e2e-spec.ts`。不覆寫 `LLM_PROVIDER`，讓 module 的 factory 依覆寫後的
 * `ConfigService` 建 provider，驗正式的組裝路徑。token 來源換成可變的 mock；`fetch` 在建 app 之前
 * 就攔下，回 Anthropic Messages 格式的假回應。整份測試不連 Google。
 *
 * T0 時 factory 還不認得 `vertex-anthropic`，會落到 GLM 分支；`GLM_API_KEY` 設成空字串，
 * 讓它穩定回 503 `AI_NOT_CONFIGURED`，Haiku 的斷言因此是紅的。`fake` 的正向對照要綠，
 * 用來證明紅燈來自 factory，不是測試本身的組裝。
 */
describe('AI Vertex Anthropic (Haiku) provider isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bob: Person;
  const getAccessToken = jest.fn<Promise<string>, []>();
  const tokenSource: AccessTokenSource = { getAccessToken };
  const today = '2040-03-01';
  let fetchSpy: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>;

  /** 依 `LLM_PROVIDER` 建一個獨立的 app。額度上限直接給數字，避免從原始 env 讀到字串。 */
  function buildApp(provider: 'vertex-anthropic' | 'fake') {
    const config = new ConfigService<Env, true>({
      ...process.env,
      JWT_EXPIRES_IN: '7d',
      LLM_PROVIDER: provider,
      VERTEX_PROJECT_ID: PROJECT,
      VERTEX_LOCATION: 'global',
      VERTEX_MODEL: MODEL,
      // T0 落到 GLM 分支時要穩定是「未設定」，不能因為本機 .env.test 有金鑰就去連 GLM。
      GLM_API_KEY: '',
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

  /** Anthropic Messages 格式的假回應：1 個 text block。 */
  function message(text: string, stopReason: string, extra: Record<string, unknown> = {}) {
    return new Response(
      JSON.stringify({
        id: 'msg_aih_e2e',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content: [{ type: 'text', text }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: USAGE,
        ...extra,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const emptyDrafts = () => message('{"drafts":[]}', 'end_turn');
  const refusal = () =>
    message(`I can't help with that. ${REFUSAL_TEXT}`, 'refusal', {
      stop_details: { type: 'refusal', category: REFUSAL_CATEGORY, explanation: REFUSAL_TEXT },
    });
  const badRequest = () =>
    new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: `schema rejected: ${ERROR_BODY}` },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );

  beforeAll(async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(emptyDrafts()));
    ({ app, prisma } = await buildApp('vertex-anthropic'));
  });
  beforeEach(async () => {
    await resetDb(prisma);
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue(TOKEN);
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => Promise.resolve(emptyDrafts()));
    bob = await person(app, 'bob@example.com', 'Bob');
  });
  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  function parse(target: INestApplication = app, ledgerId: string = bob.ledgerId) {
    return request(httpServer(target))
      .post('/api/ai/parse-transaction')
      .set(auth(bob.token))
      .send({ text: '今天天氣很好', ledgerId, today });
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

  it('SC-P45: a refusal returns 200 with no drafts, counts the call with its usage, logs refusal only', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(refusal()));
    const logs = captureLogs();
    try {
      const res = await parse().expect(200);
      expect(res.body).toEqual({ drafts: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const personal = await prisma.aiParseDailyUsage.findMany();
      const global = await prisma.aiDailyUsage.findMany();
      expect(personal).toEqual([
        expect.objectContaining({
          userId: bob.userId,
          calls: 1,
          promptTokens: 120n,
          completionTokens: 30n,
          usageUnknownCalls: 0,
        }),
      ]);
      expect(global).toEqual([
        expect.objectContaining({
          calls: 1,
          promptTokens: 120n,
          completionTokens: 30n,
          usageUnknownCalls: 0,
        }),
      ]);

      const lines = logs.usageLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split(' ')[0]).toBe('outcome=refusal');
      expect(lines[0]).toContain(`provider=vertex-anthropic model=${MODEL}`);
      const logged = JSON.stringify(logs.logged);
      expect(logged).not.toContain(REFUSAL_TEXT);
      expect(logged).not.toContain(REFUSAL_CATEGORY);
    } finally {
      logs.restore();
    }
  });

  it('SC-P48: token, refusal text, refusal category and error body never reach responses, logs or tables', async () => {
    const logs = captureLogs();
    try {
      // 成功：token 只該出現在送往 Google 固定網址的 Authorization 標頭。
      fetchSpy.mockImplementationOnce(() => Promise.resolve(emptyDrafts()));
      const ok = await parse().expect(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(RAW_PREDICT_URL);
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);

      // 拒答：拒答文字與 stop_details 的類別都不可往外傳。
      fetchSpy.mockImplementationOnce(() => Promise.resolve(refusal()));
      const refused = await parse().expect(200);

      // HTTP 400：錯誤本文不可往外傳，只記狀態碼。
      fetchSpy.mockImplementationOnce(() => Promise.resolve(badRequest()));
      const rejected = await parse().expect(503);
      expect(rejected.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });

      // 拿不到 token：套件的錯誤訊息帶 token 也只能被轉成 auth，fetch 不被呼叫。
      getAccessToken.mockRejectedValueOnce(new Error(`invalid_grant (token ${TOKEN})`));
      const failed = await parse().expect(503);
      expect(failed.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const lines = logs.usageLines();
      expect(lines.map((line) => line.split(' ')[0])).toEqual([
        'outcome=empty',
        'outcome=refusal',
        'outcome=http',
        'outcome=auth',
      ]);
      expect(lines[2]).toContain('httpStatus=400');

      const outputs = JSON.stringify([
        ok.headers,
        ok.body,
        refused.headers,
        refused.body,
        rejected.headers,
        rejected.body,
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

  it('SC-P49: codes outside the catalog, foreign ledgers, too many drafts and long names are still filtered', async () => {
    const eve = await person(app, 'eve@example.com', 'Eve');
    const draft = (overrides: Record<string, unknown>) => ({
      type: 'EXPENSE',
      ledger: null,
      amountYuan: '60',
      date: '2040-02-28',
      title: '早餐',
      category: null,
      newCategory: null,
      account: '?',
      toAccount: null,
      ...overrides,
    });
    const tooLong = '貓'.repeat(51);
    const drafts = [
      // 1. 別人帳本的原始 UUID：落回目前帳本，新分類一併作廢。
      draft({ ledger: eve.ledgerId, title: '一', newCategory: '寵物美容' }),
      // 2. 不在清單裡的帳本代號：同上。
      draft({ ledger: 'L99', title: '二', newCategory: '寵物美容' }),
      // 3. 超過 50 字的新分類名稱：不提議。
      draft({ title: '三', newCategory: tooLong }),
      // 4. 正向對照：合法的新分類名稱照留。
      draft({ title: '四', newCategory: '寵物美容' }),
      // 5. 不在清單裡的分類與帳戶代號：都留空。
      draft({ title: '五', category: 'C99', account: 'A99' }),
      // 6～11. 補到 11 筆，超過 AI_MAX_DRAFTS（10）。
      ...['六', '七', '八', '九', '十', '十一'].map((title) => draft({ title })),
    ];
    fetchSpy.mockImplementation(() =>
      Promise.resolve(message(JSON.stringify({ drafts }), 'end_turn')),
    );

    const res = await parse().expect(200);

    const expected = (overrides: Partial<TransactionDraft>): TransactionDraft => ({
      ledgerId: bob.ledgerId,
      type: 'EXPENSE',
      amount: 6000,
      date: '2040-02-28',
      title: '早餐',
      categoryId: null,
      newCategoryName: null,
      accountId: null,
      toAccountId: null,
      ...overrides,
    });
    const body = res.body as ParseTransactionResponse;
    expect(body.drafts).toEqual([
      expected({ title: '一' }),
      expected({ title: '二' }),
      expected({ title: '三' }),
      expected({ title: '四', newCategoryName: '寵物美容' }),
      expected({ title: '五' }),
      ...['六', '七', '八', '九', '十'].map((title) => expected({ title })),
    ]);
    expect(JSON.stringify(body)).not.toContain(eve.ledgerId);
  });
});
