import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Express } from 'express';
import type { Account, Category, ParseTransactionResponse, TransactionDraft } from '@ledger/shared';
import request from 'supertest';
import { FakeLlmProvider } from '../src/ai/fake-llm.provider';
import { AI_CLOCK } from '../src/ai/ai-quota.tokens';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LLMProvider,
  type LlmRequest,
  type LlmResponse,
} from '../src/ai/llm-provider';
import { createLlmProvider } from '../src/ai/llm-provider.factory';
import type { Env } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * SC-P1～P9、P26：真正 HTTP 與測試資料庫，正常句子走假 provider，惡意資料走注入 stub。
 * 限流另外開啟並換 token／IP／帳本；不存不記同時攔日誌、掃文字欄位、比對所有表筆數。
 */
describe('AI parse transaction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bob: Person;
  let tripId: string;
  let cardId: string;
  let savingsId: string;
  let categories: Category[];
  const fake = new FakeLlmProvider();
  const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>();
  const stub: LLMProvider = {
    descriptor: { configured: true, provider: 'stub', model: null },
    complete,
  };
  const today = '2040-03-01';
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp((builder) =>
      builder
        .overrideProvider(LLM_PROVIDER)
        .useValue(stub)
        // 固定額度日期，避免 SC-P26 的四次呼叫恰好跨過台灣午夜而拆成兩列。
        .overrideProvider(AI_CLOCK)
        .useValue(() => new Date('2026-10-24T12:00:00Z')),
    ));
    // 限流測試真的讓 X-Forwarded-For 成為不同 IP，不只改了未被使用的標頭。
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', 1);
  });
  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    await resetDb(prisma);
    complete.mockReset().mockImplementation((input) => fake.complete(input));
    bob = await person(app, 'bob@example.com', 'Bob');
    await request(httpServer(app))
      .patch(`/api/ledgers/${bob.ledgerId}`)
      .set(auth(bob.token))
      .send({ name: '日常' })
      .expect(200);
    tripId = await createSharedLedger(app, bob.token, '旅行基金');
    for (const name of ['早餐', '午餐'])
      await request(httpServer(app))
        .post(`/api/ledgers/${bob.ledgerId}/categories`)
        .set(auth(bob.token))
        .send({ name, type: 'EXPENSE' })
        .expect(201);
    categories = (
      await request(httpServer(app))
        .get(`/api/ledgers/${bob.ledgerId}/categories`)
        .set(auth(bob.token))
        .expect(200)
    ).body as Category[];
    cardId = (
      (
        await request(httpServer(app))
          .post('/api/accounts')
          .set(auth(bob.token))
          .send({ name: '信用卡', initialBalance: 0 })
          .expect(201)
      ).body as Account
    ).id;
    savingsId = (
      (
        await request(httpServer(app))
          .post('/api/accounts')
          .set(auth(bob.token))
          .send({ name: '儲蓄', initialBalance: 0 })
          .expect(201)
      ).body as Account
    ).id;
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });
  afterAll(() => app.close());

  function parse(text: string, ledgerId = bob.ledgerId, token = bob.token, ip?: string) {
    const req = request(httpServer(app)).post('/api/ai/parse-transaction').set(auth(token));
    if (ip) req.set('X-Forwarded-For', ip);
    return req.send({ text, ledgerId, today });
  }
  const categoryId = (name: string) => categories.find((row) => row.name === name)!.id;
  const responseDrafts = (body: unknown) => (body as ParseTransactionResponse).drafts;
  const expected = (overrides: Partial<TransactionDraft>): TransactionDraft => ({
    ledgerId: bob.ledgerId,
    type: 'EXPENSE',
    amount: 6000,
    date: today,
    title: '早餐',
    categoryId: categoryId('早餐'),
    newCategoryName: null,
    accountId: bob.cashId,
    toAccountId: null,
    ...overrides,
  });
  async function transaction(ledgerId: string, accountId: string, category: string) {
    return request(httpServer(app))
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(bob.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2039-12-01T12:00:00.000Z',
        accountId,
        categoryId: category,
      })
      .expect(201);
  }
  function wire(overrides: Record<string, unknown> = {}) {
    return {
      type: 'EXPENSE',
      ledger: null,
      amountYuan: '60',
      date: null,
      title: '早餐',
      category: null,
      newCategory: null,
      account: null,
      toAccount: null,
      ...overrides,
    };
  }
  function dataOf(input: LlmRequest) {
    return JSON.parse(/^<ai-data>(.*)<\/ai-data>$/m.exec(input.system)![1]!) as {
      ledgers: { code: string; name: string }[];
      categories: { code: string; name: string; type: string; ledger: string }[];
      accounts: { code: string; name: string }[];
      currentLedger: string;
    };
  }

  it('SC-P1: preserves both drafts and all exact fields in sentence order', async () => {
    const res = await parse('  早餐 60 現金、午餐 120 刷卡  ').expect(200);
    expect(responseDrafts(res.body)).toEqual([
      expected({}),
      expected({ title: '午餐', amount: 12000, categoryId: categoryId('午餐'), accountId: cardId }),
    ]);
    expect(complete.mock.calls[0]![0].user).toBe('早餐 60 現金、午餐 120 刷卡');
  });
  it('SC-P2: confirms through the existing transaction API and changes balance only then', async () => {
    const accountsBefore = (
      await request(httpServer(app)).get('/api/accounts').set(auth(bob.token)).expect(200)
    ).body as Account[];
    const res = await parse('早餐 60 現金、午餐 120 刷卡').expect(200);
    expect(await prisma.transaction.count()).toBe(0);
    const draft = responseDrafts(res.body)[0]!;
    await request(httpServer(app))
      .post(`/api/ledgers/${draft.ledgerId}/transactions`)
      .set(auth(bob.token))
      .send({
        type: draft.type,
        amount: draft.amount,
        date: `${draft.date}T00:00:00.000Z`,
        title: draft.title,
        categoryId: draft.categoryId,
        accountId: draft.accountId,
      })
      .expect(201);
    const accountsAfter = (
      await request(httpServer(app)).get('/api/accounts').set(auth(bob.token)).expect(200)
    ).body as Account[];
    expect(accountsAfter.find((row) => row.id === bob.cashId)!.balance).toBe(
      accountsBefore.find((row) => row.id === bob.cashId)!.balance - 6000,
    );
    const listing = await request(httpServer(app))
      .get(`/api/ledgers/${bob.ledgerId}/transactions`)
      .set(auth(bob.token))
      .expect(200);
    expect((listing.body as { items: { title: string; amount: number }[] }).items).toEqual([
      expect.objectContaining({ title: '早餐', amount: 6000 }),
    ]);
  });
  it('SC-P3/P4: computes yesterday from client today and uses record-defaults', async () => {
    expect(new Date().toISOString().slice(0, 10)).not.toBe(today);
    await transaction(bob.ledgerId, savingsId, categoryId('早餐'));
    expect(responseDrafts((await parse('昨天計程車 250').expect(200)).body)).toEqual([
      expected({
        amount: 25000,
        date: '2040-02-29',
        title: '計程車',
        categoryId: categoryId('交通'),
        accountId: savingsId,
      }),
    ]);
    expect(responseDrafts((await parse('早餐 60').expect(200)).body)).toEqual([
      expected({ accountId: savingsId }),
    ]);
  });
  it('SC-P4: changed ledger gets its own default; no history gives null', async () => {
    expect(responseDrafts((await parse('早餐 60').expect(200)).body)[0]!.accountId).toBeNull();
    const tripCategory = await prisma.category.findFirstOrThrow({
      where: { ledgerId: tripId, type: 'EXPENSE' },
    });
    await transaction(tripId, cardId, tripCategory.id);
    await transaction(bob.ledgerId, savingsId, categoryId('早餐'));
    expect(responseDrafts((await parse('旅行基金 機票 8000').expect(200)).body)).toEqual([
      expected({
        ledgerId: tripId,
        amount: 800000,
        title: '機票',
        categoryId: null,
        accountId: cardId,
      }),
    ]);
  });
  it('SC-P5: transfer has exact source, destination and no category', async () => {
    expect(responseDrafts((await parse('從儲蓄轉 5000 到現金').expect(200)).body)).toEqual([
      expected({
        type: 'TRANSFER',
        amount: 500000,
        title: '轉帳',
        categoryId: null,
        accountId: savingsId,
        toAccountId: bob.cashId,
      }),
    ]);
  });
  it('SC-P6: named writable ledger proposes a fitting category that is not present', async () => {
    const tripCategories = (
      await request(httpServer(app))
        .get(`/api/ledgers/${tripId}/categories`)
        .set(auth(bob.token))
        .expect(200)
    ).body as Category[];
    for (const category of tripCategories.filter(
      (row) => row.name === '交通' && row.type === 'EXPENSE',
    ))
      await request(httpServer(app))
        .delete(`/api/ledgers/${tripId}/categories/${category.id}`)
        .set(auth(bob.token))
        .expect(204);
    const categoryCountBefore = await prisma.category.count();
    expect(responseDrafts((await parse('旅行基金 機票 8000 刷卡').expect(200)).body)).toEqual([
      expected({
        ledgerId: tripId,
        amount: 800000,
        title: '機票',
        categoryId: null,
        newCategoryName: '交通',
        accountId: cardId,
      }),
    ]);
    expect(await prisma.category.count()).toBe(categoryCountBefore);
  });
  it('proposes 日用品 for 衛生紙 without creating a category during parsing', async () => {
    await transaction(bob.ledgerId, bob.cashId, categoryId('早餐'));
    const categoryCountBefore = await prisma.category.count();
    expect(responseDrafts((await parse('衛生紙 189').expect(200)).body)).toEqual([
      expected({
        amount: 18900,
        title: '衛生紙',
        categoryId: null,
        newCategoryName: '日用品',
        accountId: bob.cashId,
      }),
    ]);
    expect(await prisma.category.count()).toBe(categoryCountBefore);
  });
  it('reuses an existing 日用品 category for repeated proposals without creating it during parsing', async () => {
    await transaction(bob.ledgerId, bob.cashId, categoryId('早餐'));
    const firstParseCategoryCount = await prisma.category.count();
    const firstParse = responseDrafts((await parse('洗碗精 99、垃圾袋 60').expect(200)).body);
    expect(firstParse).toEqual([
      expected({
        amount: 9900,
        title: '洗碗精',
        categoryId: null,
        newCategoryName: '日用品',
        accountId: bob.cashId,
      }),
      expected({
        amount: 6000,
        title: '垃圾袋',
        categoryId: null,
        newCategoryName: '日用品',
        accountId: bob.cashId,
      }),
    ]);
    expect(await prisma.category.count()).toBe(firstParseCategoryCount);

    const createdCategory = (
      await request(httpServer(app))
        .post(`/api/ledgers/${bob.ledgerId}/categories`)
        .set(auth(bob.token))
        .send({ name: '日用品', type: 'EXPENSE' })
        .expect(201)
    ).body as Category;
    const secondParseCategoryCount = await prisma.category.count();
    expect(responseDrafts((await parse('洗碗精 99、垃圾袋 60').expect(200)).body)).toEqual([
      expected({
        amount: 9900,
        title: '洗碗精',
        categoryId: createdCategory.id,
        newCategoryName: null,
        accountId: bob.cashId,
      }),
      expected({
        amount: 6000,
        title: '垃圾袋',
        categoryId: createdCategory.id,
        newCategoryName: null,
        accountId: bob.cashId,
      }),
    ]);
    expect(await prisma.category.count()).toBe(secondParseCategoryCount);
  });
  it('SC-P6: viewer, archived and left ledger names are absent and fall back to current ledger', async () => {
    const carol = await person(app, 'carol@example.com', 'Carol');
    for (const [name, role] of [
      ['公司聚餐', 'VIEWER'],
      ['去年墾丁', 'EDITOR'],
      ['舊室友', 'EDITOR'],
    ] as const) {
      const ledgerId = await createSharedLedger(app, carol.token, name);
      await request(httpServer(app))
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(carol.token))
        .send({ email: bob.email, role })
        .expect(201);
      if (name === '去年墾丁')
        await request(httpServer(app))
          .post(`/api/ledgers/${ledgerId}/archive`)
          .set(auth(carol.token))
          .expect(201);
      if (name === '舊室友')
        await request(httpServer(app))
          .post(`/api/ledgers/${ledgerId}/leave`)
          .set(auth(bob.token))
          .send({ targetLedgerId: null, excludedItemIds: [] })
          .expect(204);
      expect(responseDrafts((await parse(`${name} 早餐 60`).expect(200)).body)).toEqual([
        expected({ accountId: null }),
      ]);
      expect(complete.mock.calls.at(-1)![0].system).not.toContain(name);
    }
  });
  it('parses income through the same manual transaction contract', async () => {
    expect(responseDrafts((await parse('薪水 30000').expect(200)).body)).toEqual([
      expected({
        type: 'INCOME',
        amount: 3000000,
        title: '薪水',
        categoryId: categoryId('薪資'),
        accountId: null,
      }),
    ]);
  });
  it('SC-P7: rejects wrong category type/ledger and hostile fields while keeping valid fields', async () => {
    complete.mockImplementationOnce((input) => {
      const data = dataOf(input);
      const income = data.categories.find(
        (row) => row.ledger === data.currentLedger && row.type === 'INCOME',
      )!.code;
      const foreignCategory = data.categories.find(
        (row) => row.ledger !== data.currentLedger,
      )!.code;
      const cash = data.accounts.find((row) => row.name === '現金')!.code;
      return Promise.resolve({
        truncated: false,
        content: {
          drafts: [
            wire({
              category: income,
              account: cash,
              amountYuan: '-5',
              date: '2026-02-30',
              payerPersonId: 'foreign',
              ledgerSplit: {},
            }),
            wire({ category: foreignCategory, account: cash }),
          ],
        },
      });
    });
    expect(responseDrafts((await parse('惡意輸出').expect(200)).body)).toEqual([
      expected({ categoryId: null, amount: null, date: null }),
      expected({ categoryId: null }),
    ]);
  });
  it('SC-P13(b)/(e): suppresses proposals after an invalid category or unresolved ledger', async () => {
    await transaction(bob.ledgerId, bob.cashId, categoryId('早餐'));
    const categoryCountBefore = await prisma.category.count();
    complete.mockImplementationOnce((input) => {
      dataOf(input);
      return Promise.resolve({
        truncated: false,
        content: {
          drafts: [
            wire({ category: 'C999', newCategory: '日用品' }),
            wire({ ledger: 'L999', category: null, newCategory: '日用品' }),
          ],
        },
      });
    });
    expect(responseDrafts((await parse('惡意輸出').expect(200)).body)).toEqual([
      expected({ categoryId: null, newCategoryName: null }),
      expected({ categoryId: null, newCategoryName: null }),
    ]);
    expect(await prisma.category.count()).toBe(categoryCountBefore);
  });
  it.each([null, { drafts: [] }, { drafts: 'bad' }, { drafts: [null, 1] }])(
    'SC-P8: malformed content %p is empty with 200',
    async (content) => {
      complete.mockResolvedValueOnce({ truncated: false, content });
      expect((await parse('壞格式').expect(200)).body).toEqual({ drafts: [] });
    },
  );
  it('SC-P8: only first ten slots count, even when they contain invalid elements', async () => {
    complete.mockResolvedValueOnce({
      truncated: false,
      content: { drafts: Array<unknown>(11).fill(wire()) },
    });
    expect(responseDrafts((await parse('十一筆').expect(200)).body)).toHaveLength(10);
    complete.mockResolvedValueOnce({
      truncated: false,
      content: { drafts: [null, 1, ...Array<unknown>(9).fill(wire())] },
    });
    expect(responseDrafts((await parse('壞元素').expect(200)).body)).toHaveLength(8);
  });
  it('SC-P8: unknown or out of scope input produces zero drafts', async () => {
    for (const text of [
      '今天天氣很好',
      '借小華 500',
      '小明付晚餐 900，三人平分',
      '這個月吃飯花多少',
    ])
      expect((await parse(text).expect(200)).body).toEqual({ drafts: [] });
  });
  it.each([
    { text: ' ' },
    { text: 'a'.repeat(201) },
    { text: 1 },
    { today: '2026-02-30' },
    { today: '2026-2-01' },
    { ledgerId: 'bad' },
  ])('rejects invalid DTO %p before provider', async (overrides) => {
    await request(httpServer(app))
      .post('/api/ai/parse-transaction')
      .set(auth(bob.token))
      .send({ text: '早餐 60', ledgerId: bob.ledgerId, today, ...overrides })
      .expect(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it('SC-P9: authentication is required', async () => {
    await request(httpServer(app))
      .post('/api/ai/parse-transaction')
      .send({ text: '早餐 60', ledgerId: bob.ledgerId, today })
      .expect(401);
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(['http', 'network', 'timeout'] as const)(
    'SC-P9: provider %s error is safe AI_UNAVAILABLE',
    async (kind) => {
      complete.mockRejectedValueOnce(new LlmProviderError(kind, 500, 15000));
      const res = await parse('早餐 60').expect(503);
      expect(res.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
    },
  );
  it('SC-P9: GLM settings are overridden in another app; non-AI endpoints still work', async () => {
    const config = new ConfigService<Env, true>({
      ...process.env,
      JWT_EXPIRES_IN: '7d',
      LLM_PROVIDER: 'glm',
      GLM_API_KEY: ' ',
      GLM_MODEL: '',
    });
    const other = await createE2EApp((builder) =>
      builder
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(LLM_PROVIDER)
        .useValue(createLlmProvider(config)),
    );
    try {
      const res = await request(httpServer(other.app))
        .post('/api/ai/parse-transaction')
        .set(auth(bob.token))
        .send({ text: '早餐 60', ledgerId: bob.ledgerId, today })
        .expect(503);
      expect(res.body).toMatchObject({ errorCode: 'AI_NOT_CONFIGURED' });
      await request(httpServer(other.app)).get('/api/users/me').set(auth(bob.token)).expect(200);
    } finally {
      await other.app.close();
    }
  });

  it('SC-P9: same user shares ten across different verified tokens, IPs and ledgers; other endpoints keep their own limits', async () => {
    const token2 = app
      .get(JwtService)
      .sign({ sub: bob.userId, email: bob.email, jti: 'second-verified-token' });
    expect(token2).not.toBe(bob.token);
    process.env.NODE_ENV = 'ai-throttle-test';
    for (let index = 0; index < 10; index += 1) {
      const res = await parse(
        '今天天氣很好',
        index % 2 ? tripId : bob.ledgerId,
        index % 2 ? token2 : bob.token,
        `192.0.2.${index + 1}`,
      ).expect(200);
      expect(res.headers['x-ratelimit-limit']).toBe('100');
      expect(res.headers['x-ratelimit-limit-ai-user']).toBe('10');
    }
    await parse('今天天氣很好', bob.ledgerId, token2, '198.51.100.8').expect(429);
    for (let index = 0; index < 11; index += 1)
      await request(httpServer(app)).get('/api/users/me').set(auth(bob.token)).expect(200);
    for (let index = 0; index < 10; index += 1)
      await request(httpServer(app))
        .post('/api/friend-requests')
        .set(auth(bob.token))
        .send({ email: `nobody${index}@example.com` })
        .expect(404);
    await request(httpServer(app))
      .post('/api/friend-requests')
      .set(auth(bob.token))
      .send({ email: 'last@example.com' })
      .expect(429);
  });
  it('SC-P9: two users on the same IP each get ten', async () => {
    const carol = await person(app, 'carol@example.com', 'Carol');
    process.env.NODE_ENV = 'ai-throttle-test';
    for (let index = 0; index < 10; index += 1) {
      await parse('今天天氣很好', bob.ledgerId, bob.token, '203.0.113.1').expect(200);
      await parse('今天天氣很好', carol.ledgerId, carol.token, '203.0.113.1').expect(200);
    }
    await parse('今天天氣很好', bob.ledgerId, bob.token, '203.0.113.1').expect(429);
    await parse('今天天氣很好', carol.ledgerId, carol.token, '203.0.113.1').expect(429);
  });

  it('SC-P26: only numeric usage changes; input/output never persists or appears in logs', async () => {
    const marker = 'AI_PRIVATE_SENTINEL_74b62';
    const logged: unknown[][] = [];
    const spies = [
      ...(['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((method) =>
        jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      ),
      ...(['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((method) =>
        jest.spyOn(Logger, method).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      ),
      ...(['log', 'error', 'warn', 'debug', 'info', 'trace'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      ),
    ];
    const counts = async () => {
      const tables = await prisma.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'AiParseDailyUsage', 'AiDailyUsage') ORDER BY tablename`;
      return Promise.all(
        tables.map(async ({ tablename }) => ({
          table: tablename,
          contents: (
            await prisma.$queryRaw<{ contents: string }[]>`
              SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb)::text AS contents
              FROM ${Prisma.raw(`"${tablename.replaceAll('"', '""')}"`)} t`
          )[0]!.contents,
        })),
      );
    };
    try {
      new Logger('positive control').error(marker);
      Logger.warn(marker);
      console.log(marker);
      expect(logged.filter((args) => JSON.stringify(args).includes(marker))).toHaveLength(3);
      logged.length = 0;
      const before = await counts();
      complete.mockResolvedValueOnce({
        truncated: false,
        content: { drafts: [wire({ title: marker })] },
      });
      await parse(marker).expect(200);
      complete.mockResolvedValueOnce({ truncated: false, content: null });
      await parse(marker).expect(200);
      complete.mockRejectedValueOnce(new LlmProviderError('http', 503, 20));
      await parse(marker).expect(503);
      complete.mockRejectedValueOnce(new LlmProviderError('timeout', null, 15000));
      await parse(marker).expect(503);
      expect(JSON.stringify(logged)).not.toContain(marker);
      expect(await counts()).toEqual(before);
      const personal = await prisma.aiParseDailyUsage.findMany();
      const global = await prisma.aiDailyUsage.findMany();
      expect(personal).toHaveLength(1);
      expect(global).toHaveLength(1);
      expect(personal[0]).toMatchObject({
        userId: bob.userId,
        calls: 4,
        promptTokens: 0n,
        completionTokens: 0n,
        usageUnknownCalls: 4,
      });
      expect(global[0]).toMatchObject({
        calls: 4,
        promptTokens: 0n,
        completionTokens: 0n,
        usageUnknownCalls: 4,
      });
      for (const row of [...personal, ...global]) {
        for (const [key, value] of Object.entries(row)) {
          if (key === 'userId') expect(value).toBe(bob.userId);
          else
            expect(
              typeof value === 'number' || typeof value === 'bigint' || value instanceof Date,
            ).toBe(true);
        }
      }
      const usageLogs = logged
        .flat()
        .filter(
          (value): value is string => typeof value === 'string' && value.startsWith('outcome='),
        );
      expect(usageLogs).toHaveLength(4);
      expect(usageLogs.map((line) => line.split(' ')[0])).toEqual([
        'outcome=success',
        'outcome=invalid',
        'outcome=http',
        'outcome=timeout',
      ]);
      for (const line of usageLogs) {
        expect(line).toMatch(
          /provider=stub model=none durationMs=\d+ promptTokens=unknown completionTokens=unknown drafts=\d+ ledgers=\d+ categories=\d+ accounts=\d+ promptBytes=\d+/,
        );
        expect(line).not.toContain(bob.userId);
      }
      expect(usageLogs[2]).toContain('httpStatus=503');
      const columns = await prisma.$queryRaw<
        { table_name: string; column_name: string }[]
      >`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')`;
      for (const column of columns) {
        const table = column.table_name.replaceAll('"', '""');
        const field = column.column_name.replaceAll('"', '""');
        const matches = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM ${Prisma.raw(`"${table}"`)}
          WHERE ${Prisma.raw(`"${field}"`)}::text LIKE ${`%${marker}%`}`;
        expect(matches[0]!.count).toBe(0n);
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
