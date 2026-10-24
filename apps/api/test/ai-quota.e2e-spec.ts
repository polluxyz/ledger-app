import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { AI_CLOCK, AI_QUOTA_LIMITS, type AiQuotaLimits } from '../src/ai/ai-quota.tokens';
import { AiQuotaService } from '../src/ai/ai-quota.service';
import * as draftValidation from '../src/ai/ai-draft-validation';
import { AI_WIRE_JSON_SCHEMA } from '../src/ai/ai-wire-format';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LLMProvider,
  type LlmResponse,
} from '../src/ai/llm-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/** SC-P18～P24：用真正 PostgreSQL 驗證原子扣額度、併發與跨午夜；模型一律用可控 stub。 */
describe('AI daily quota (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bob: Person;
  let instant: Date;
  const defaults: AiQuotaLimits = { perUserDaily: 50, globalDaily: 500, maxOutputTokens: 2048 };
  const limits = { ...defaults };
  const descriptor = { configured: true, provider: 'stub', model: 'model-a' };
  const complete = jest.fn<Promise<LlmResponse>, Parameters<LLMProvider['complete']>>();
  const stub: LLMProvider = { descriptor, complete };
  const usage = { promptTokens: 17, completionTokens: 5 };
  const day = new Date('2026-10-24T00:00:00Z');

  async function start() {
    ({ app, prisma } = await createE2EApp((builder) =>
      builder
        .overrideProvider(LLM_PROVIDER)
        .useValue(stub)
        .overrideProvider(AI_QUOTA_LIMITS)
        .useValue(limits)
        .overrideProvider(AI_CLOCK)
        .useValue(() => instant),
    ));
  }

  beforeAll(start);
  beforeEach(async () => {
    await resetDb(prisma);
    instant = new Date('2026-10-24T15:59:59Z');
    Object.assign(limits, defaults);
    Object.assign(descriptor, { configured: true, provider: 'stub', model: 'model-a' });
    complete.mockReset().mockResolvedValue({ content: { drafts: [] }, usage, truncated: false });
    bob = await person(app, 'bob@example.com', 'Bob');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  function parse(who = bob, today = '2040-01-01') {
    return request(httpServer(app))
      .post('/api/ai/parse-transaction')
      .set(auth(who.token))
      .send({ text: '早餐 60', ledgerId: who.ledgerId, today });
  }
  const personal = (userId = bob.userId) =>
    prisma.aiParseDailyUsage.findUniqueOrThrow({ where: { userId_day: { userId, day } } });
  const global = () => prisma.aiDailyUsage.findUniqueOrThrow({ where: { day } });
  const wire = () => ({
    type: 'EXPENSE',
    ledger: null,
    amountYuan: '60',
    date: null,
    title: '早餐',
    category: null,
    newCategory: null,
    account: null,
    toAccount: null,
  });

  /** 同時攔下 instance、static Logger 與 console，防止換了通道就漏掉機敏字串。 */
  function captureLogs() {
    const messages: unknown[][] = [];
    for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        messages.push(args);
      });
      jest.spyOn(Logger, method).mockImplementation((...args: unknown[]) => {
        messages.push(args);
      });
    }
    for (const method of ['log', 'error', 'warn', 'debug', 'info', 'trace'] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        messages.push(args);
      });
    }
    return messages;
  }
  const usageLines = (messages: unknown[][]) =>
    messages
      .flat()
      .filter(
        (value): value is string => typeof value === 'string' && value.startsWith('outcome='),
      );

  it('SC-P18.4/P21.3: restarting app and changing provider/model does not reset quota', async () => {
    limits.perUserDaily = 1;
    await parse().expect(200);
    await app.close();
    descriptor.provider = 'another-stub';
    descriptor.model = 'model-b';
    await start();
    await parse().expect(429);
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await personal()).calls).toBe(1);
    expect((await global()).calls).toBe(1);
  });

  it('SC-P19.1: two A calls and one B call exhaust the global limit', async () => {
    limits.globalDaily = 3;
    limits.perUserDaily = 10;
    const alice = await person(app, 'alice@example.com', 'Alice');
    await parse(alice).expect(200);
    await parse(alice).expect(200);
    await parse().expect(200);
    expect((await parse().expect(503)).body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
    expect(complete).toHaveBeenCalledTimes(3);
    expect((await personal()).calls).toBe(1);
  });

  it('SC-P19.3/4: only one user gets the last global call; loser leaves no personal row', async () => {
    limits.globalDaily = 2;
    await parse().expect(200);
    const alice = await person(app, 'alice@example.com', 'Alice');
    const eve = await person(app, 'eve@example.com', 'Eve');
    complete.mockClear();
    const responses = await Promise.all([parse(alice), parse(eve)]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 503]);
    expect(complete).toHaveBeenCalledTimes(1);
    const loser = responses[0].status === 503 ? alice : eve;
    expect(await prisma.aiParseDailyUsage.count({ where: { userId: loser.userId } })).toBe(0);
    expect((await global()).calls).toBe(2);
  });

  it('SC-P19.5: personal rejection wins when both positive limits are exhausted and logs once', async () => {
    limits.perUserDaily = 1;
    limits.globalDaily = 1;
    await parse().expect(200);
    const messages = captureLogs();
    expect((await parse().expect(429)).body).toMatchObject({ errorCode: 'AI_DAILY_LIMIT' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(usageLines(messages)).toHaveLength(1);
    expect(usageLines(messages)[0]).toMatch(/^outcome=quota_user /);
  });

  it('SC-P19.6: deleting a user cascades personal usage but keeps global totals', async () => {
    await parse().expect(200);
    const before = await global();
    await prisma.user.delete({ where: { id: bob.userId } });
    expect(await prisma.aiParseDailyUsage.count()).toBe(0);
    expect(await global()).toEqual(before);
  });

  it.each([
    [2, 5],
    [1, 3],
  ])('SC-P20.1/2: %i personal slots with %i concurrent first calls', async (limit, requests) => {
    limits.perUserDaily = limit;
    const responses = await Promise.all(Array.from({ length: requests }, () => parse()));
    expect(responses.filter((res) => res.status === 200)).toHaveLength(limit);
    expect(responses.filter((res) => res.status === 429)).toHaveLength(requests - limit);
    expect(complete).toHaveBeenCalledTimes(limit);
    expect(await prisma.aiParseDailyUsage.count()).toBe(1);
    expect(await prisma.aiDailyUsage.count()).toBe(1);
    expect(await personal()).toMatchObject({
      calls: limit,
      promptTokens: BigInt(17 * limit),
      completionTokens: BigInt(5 * limit),
      usageUnknownCalls: 0,
    });
    expect(await global()).toMatchObject({
      calls: limit,
      promptTokens: BigInt(17 * limit),
      completionTokens: BigInt(5 * limit),
      usageUnknownCalls: 0,
    });
  });

  it('SC-P20.3: interleaved reserves and token writes do not lose totals', async () => {
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    complete.mockImplementationOnce(async () => {
      firstEntered();
      await release;
      return { content: { drafts: [] }, usage, truncated: false };
    });
    const first = parse().then((res) => res);
    await entered;
    try {
      expect(await personal()).toMatchObject({ calls: 1, usageUnknownCalls: 1 });
      await Promise.all([parse().expect(200), parse().expect(200), parse().expect(200)]);
    } finally {
      releaseFirst();
    }
    expect((await first).status).toBe(200);
    for (const row of [await personal(), await global()]) {
      expect(row).toMatchObject({
        calls: 4,
        promptTokens: 68n,
        completionTokens: 20n,
        usageUnknownCalls: 0,
      });
    }
  });

  it.each([
    ['http', new LlmProviderError('http', 401, 10)],
    ['timeout', new LlmProviderError('timeout', null, 10)],
    ['network', new LlmProviderError('network', null, 10)],
  ] as const)(
    'SC-P21.2: %s counts once as unknown and logs once without retry',
    async (kind, error) => {
      const messages = captureLogs();
      const record = jest.spyOn(app.get(AiQuotaService), 'record');
      complete.mockRejectedValueOnce(error);
      await parse().expect(503);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(bob.userId, '2026-10-24', null);
      for (const row of [await personal(), await global()]) {
        expect(row).toMatchObject({
          calls: 1,
          promptTokens: 0n,
          completionTokens: 0n,
          usageUnknownCalls: 1,
        });
      }
      expect(usageLines(messages)).toHaveLength(1);
      expect(usageLines(messages)[0]).toContain(`outcome=${kind}`);
      if (kind === 'http') expect(usageLines(messages)[0]).toContain('httpStatus=401');
    },
  );

  it('distinguishes known zero usage from absent usage', async () => {
    complete.mockResolvedValueOnce({ content: { drafts: [] }, truncated: false });
    await parse().expect(200);
    complete.mockResolvedValueOnce({
      content: { drafts: [] },
      usage: { promptTokens: 0, completionTokens: 0 },
      truncated: false,
    });
    await parse().expect(200);
    for (const row of [await personal(), await global()]) {
      expect(row).toMatchObject({
        calls: 2,
        promptTokens: 0n,
        completionTokens: 0n,
        usageUnknownCalls: 1,
      });
    }
  });

  it.each([
    ['invalid', null, false],
    ['empty', { drafts: [] }, false],
    ['truncated', { drafts: [wire()] }, true],
  ] as const)(
    'SC-P21.2: %s counts usage even with no returned drafts',
    async (outcome, content, truncated) => {
      const messages = captureLogs();
      complete.mockResolvedValueOnce({ content, usage, truncated });
      expect((await parse().expect(200)).body).toEqual({ drafts: [] });
      for (const row of [await personal(), await global()]) {
        expect(row).toMatchObject({
          calls: 1,
          promptTokens: 17n,
          completionTokens: 5n,
          usageUnknownCalls: 0,
        });
      }
      expect(usageLines(messages)).toHaveLength(1);
      expect(usageLines(messages)[0]).toContain(`outcome=${outcome}`);
    },
  );

  it('SC-P21.2: unexpected validation exception counts usage and logs internal', async () => {
    const messages = captureLogs();
    jest.spyOn(draftValidation, 'validateAiDrafts').mockImplementationOnce(() => {
      throw new Error('validation failure');
    });
    await parse().expect(500);
    for (const row of [await personal(), await global()]) {
      expect(row).toMatchObject({
        calls: 1,
        promptTokens: 17n,
        completionTokens: 5n,
        usageUnknownCalls: 0,
      });
    }
    expect(usageLines(messages)).toHaveLength(1);
    expect(usageLines(messages)[0]).toContain('outcome=internal');
  });

  it('SC-P22.1: Taiwan midnight starts a new day with independent quota', async () => {
    limits.perUserDaily = 1;
    await parse().expect(200);
    instant = new Date('2026-10-24T16:00:00Z');
    await parse().expect(200);
    const rows = await prisma.aiParseDailyUsage.findMany({ orderBy: { day: 'asc' } });
    expect(rows.map((row) => [row.day.toISOString().slice(0, 10), row.calls])).toEqual([
      ['2026-10-24', 1],
      ['2026-10-25', 1],
    ]);
    expect(await prisma.aiDailyUsage.count()).toBe(2);
  });

  it('SC-P22.2: different client today values still reserve the same server day', async () => {
    await parse(bob, '2040-01-01').expect(200);
    await parse(bob, '2020-01-01').expect(200);
    expect(await prisma.aiParseDailyUsage.count()).toBe(1);
    expect((await personal()).calls).toBe(2);
    expect((await global()).calls).toBe(2);
  });

  it('SC-P22.3: model response after midnight writes tokens to reservation day', async () => {
    complete.mockImplementationOnce(() => {
      instant = new Date('2026-10-24T16:00:00Z');
      return Promise.resolve({ content: { drafts: [] }, usage, truncated: false });
    });
    await parse().expect(200);
    for (const row of [await personal(), await global()]) {
      expect(row).toMatchObject({
        day,
        promptTokens: 17n,
        completionTokens: 5n,
        usageUnknownCalls: 0,
      });
    }
    expect(await prisma.aiParseDailyUsage.count()).toBe(1);
    expect(await prisma.aiDailyUsage.count()).toBe(1);
  });

  it.each([
    [0, 500, 429, 'quota_user'],
    [50, 0, 503, 'quota_global'],
    [0, 0, 429, 'quota_user'],
  ] as const)(
    'SC-P23.1/2/3: disabled limits %i/%i avoid DB and provider',
    async (personalLimit, globalLimit, status, outcome) => {
      limits.perUserDaily = personalLimit;
      limits.globalDaily = globalLimit;
      const transaction = jest.spyOn(prisma, '$transaction');
      const messages = captureLogs();
      await parse().expect(status);
      expect(transaction).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(await prisma.aiParseDailyUsage.count()).toBe(0);
      expect(await prisma.aiDailyUsage.count()).toBe(0);
      expect(usageLines(messages)).toHaveLength(1);
      expect(usageLines(messages)[0]).toContain(`outcome=${outcome}`);
    },
  );

  it('SC-P23.2: global zero wins without querying an exhausted personal row', async () => {
    limits.perUserDaily = 1;
    await parse().expect(200);
    const before = await personal();
    limits.globalDaily = 0;
    const transaction = jest.spyOn(prisma, '$transaction');
    await parse().expect(503);
    expect(transaction).not.toHaveBeenCalled();
    expect(await personal()).toEqual(before);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('SC-P24.1/3: reserve DB errors return safe 500, never call provider or leak details', async () => {
    const messages = captureLogs();
    const marker = 'AI_DB_PRIVATE_SENTINEL';
    jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error(`${marker} ${bob.userId}`));
    const res = await parse().expect(500);
    expect(res.body).toMatchObject({ errorCode: 'INTERNAL_ERROR' });
    expect(complete).not.toHaveBeenCalled();
    expect(JSON.stringify([res.body, messages])).not.toContain(marker);
    expect(JSON.stringify([res.body, messages])).not.toContain(bob.userId);
    expect(messages.flat()).toContain('AI quota reserve failed');
    expect(await prisma.aiParseDailyUsage.count()).toBe(0);
    expect(await prisma.aiDailyUsage.count()).toBe(0);
  });

  it.each([200, 503])(
    'SC-P24.2/3: record DB errors preserve %i and do not leak details',
    async (status) => {
      const messages = captureLogs();
      const marker = 'AI_RECORD_PRIVATE_SENTINEL';
      if (status === 503) {
        // provider 失敗沒有 usage；只在此故障注入中讓真 record 進入資料庫失敗路徑。
        const quota = app.get(AiQuotaService);
        const record = quota.record.bind(quota);
        jest
          .spyOn(quota, 'record')
          .mockImplementation((userId, reservedDay) => record(userId, reservedDay, usage));
        complete.mockImplementationOnce(() => {
          jest
            .spyOn(prisma, '$transaction')
            .mockRejectedValueOnce(new Error(`${marker} ${bob.userId}`));
          return Promise.reject(new LlmProviderError('timeout', null, 10));
        });
      } else {
        complete.mockImplementationOnce(() => {
          jest
            .spyOn(prisma, '$transaction')
            .mockRejectedValueOnce(new Error(`${marker} ${bob.userId}`));
          return Promise.resolve({ content: { drafts: [wire()] }, usage, truncated: false });
        });
      }
      const res = await parse().expect(status);
      if (status === 200) expect((res.body as { drafts: unknown[] }).drafts).toHaveLength(1);
      else expect(res.body).toMatchObject({ errorCode: 'AI_UNAVAILABLE' });
      expect(JSON.stringify([res.body, messages])).not.toContain(marker);
      expect(JSON.stringify([res.body, messages])).not.toContain(bob.userId);
      expect(messages.flat()).toContain('AI usage record failed');
      expect(usageLines(messages)).toHaveLength(1);
      for (const row of [await personal(), await global()]) {
        expect(row).toMatchObject({
          calls: 1,
          promptTokens: 0n,
          completionTokens: 0n,
          usageUnknownCalls: 1,
        });
      }
    },
  );

  it('SC-P26: prompt bytes match three logical inputs, with only numeric counts in one log', async () => {
    const messages = captureLogs();
    await parse().expect(200);
    const sent = complete.mock.calls[0]![0];
    const bytes =
      Buffer.byteLength(sent.system) +
      Buffer.byteLength(JSON.stringify(AI_WIRE_JSON_SCHEMA)) +
      Buffer.byteLength(sent.user);
    expect(usageLines(messages)).toHaveLength(1);
    expect(usageLines(messages)[0]).toContain(`promptBytes=${bytes}`);
    expect(usageLines(messages)[0]).toMatch(/ledgers=1 categories=\d+ accounts=1/);
    expect(usageLines(messages)[0]).not.toContain(bob.userId);
    expect(usageLines(messages)[0]).not.toContain('早餐');
  });
});
