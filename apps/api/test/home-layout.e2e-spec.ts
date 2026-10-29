import { INestApplication } from '@nestjs/common';
import { DEFAULT_HOME_LAYOUT_V1, ErrorCode } from '@ledger/shared';
import type { ApiErrorResponse, HomeCardId, HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import type { HomeLayoutResponseDto } from '../src/users/dto/home-layout-response.dto';
import { createE2EApp, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/** 真實 HTTP 與 PostgreSQL 驗證 revision 競態、原始禁鍵與拒絕寫入時的資料完整性。 */
describe('Home layout — persistence and validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: Person;
  const path = '/api/users/me/home-layout/web';
  const card = (cardId: HomeCardId): HomeLayoutNode => ({ type: 'card', cardId });
  const split = (
    axis: 'x' | 'y',
    children: HomeLayoutNode[],
    weights: number[],
  ): HomeLayoutNode => ({ type: 'split', axis, children, weights });
  const nested: HomeLayoutV1 = {
    bands: [
      {
        root: split(
          'x',
          [
            card('expense'),
            split(
              'y',
              [
                split(
                  'x',
                  [card('income'), card('net'), card('trend'), card('categories')],
                  [1000, 2000, 3000, 4000],
                ),
                split('x', [card('activity'), card('accounts'), card('debts')], [3333, 3333, 3334]),
              ],
              [6000, 4000],
            ),
          ],
          [2500, 7500],
        ),
        extraHeightPx: 1600,
      },
    ],
  };
  const body = (layout: unknown = nested, expectedRevision = 0) => ({
    schemaVersion: 1,
    expectedRevision,
    layout,
  });
  const put = (data: unknown) =>
    request(httpServer(app))
      .put(path)
      .set(auth(alice.token))
      .send(data as object);
  const get = () => request(httpServer(app)).get(path).set(auth(alice.token));
  const snapshot = async () =>
    JSON.stringify(
      await prisma.userHomeLayout.findMany({ orderBy: { userId: 'asc' } }),
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
  const seedRevision = async (revision: number) => {
    await put(body()).expect(200);
    // 直接設定邊界 fixture，避免為了到達大 revision 而重複呼叫數十億次 API。
    await prisma.userHomeLayout.update({
      where: { userId_surface: { userId: alice.userId, surface: 'WEB' } },
      data: { revision: BigInt(revision) },
    });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    alice = await person(app, 'layout@example.com', 'Layout');
  });
  afterAll(async () => {
    await app.close();
  });

  it('SC-Y11: 首次建立、舊 revision 衝突、更新與重設皆符合契約', async () => {
    const initial = await get().expect(200);
    expect(initial.body).toEqual({ schemaVersion: 1, revision: 0, layout: null });
    expect(await prisma.userHomeLayout.count()).toBe(0);
    const first = await put(body()).expect(200);
    expect(first.body).toEqual({ schemaVersion: 1, revision: 1, layout: nested });
    const before = await snapshot();
    const conflict = await put(body(DEFAULT_HOME_LAYOUT_V1)).expect(409);
    expect(conflict.body).toEqual({
      statusCode: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
      message: expect.any(String) as unknown,
    });
    expect(await snapshot()).toBe(before);
    const updated = await put(body(DEFAULT_HOME_LAYOUT_V1, 1)).expect(200);
    expect(updated.body).toEqual({ schemaVersion: 1, revision: 2, layout: DEFAULT_HOME_LAYOUT_V1 });
    const reset = await put(body(null, 2)).expect(200);
    expect(reset.body).toEqual({ schemaVersion: 1, revision: 3, layout: null });
    expect((await get().expect(200)).body).toEqual(reset.body);
    // Prisma 的 JSON null 與 SQL NULL 讀回都像 null，直接查 SQL 才能證明重設語意。
    const rows = await prisma.$queryRaw<
      { isNull: boolean }[]
    >`SELECT "layout" IS NULL AS "isNull" FROM "UserHomeLayout" WHERE "userId" = ${alice.userId}`;
    expect(rows).toEqual([{ isNull: true }]);
  });

  it('SC-Y11: revision 跨越舊上限後仍持續遞增，PUT 與 GET 都回 number', async () => {
    await seedRevision(2147483646);
    for (const [expectedRevision, revision] of [
      [2147483646, 2147483647],
      [2147483647, 2147483648],
      [2147483648, 2147483649],
    ]) {
      const saved = await put(body(DEFAULT_HOME_LAYOUT_V1, expectedRevision)).expect(200);
      expect(saved.body).toEqual({ schemaVersion: 1, revision, layout: DEFAULT_HOME_LAYOUT_V1 });
      const loaded = await get().expect(200);
      expect(loaded.body).toEqual(saved.body);
      expect(typeof (saved.body as HomeLayoutResponseDto).revision).toBe('number');
      expect(typeof (loaded.body as HomeLayoutResponseDto).revision).toBe('number');
    }
  });

  it('SC-Y11: 舊上限時重設仍遞增，GET 與 SQL 均為 NULL', async () => {
    await seedRevision(2147483647);
    const reset = await put(body(null, 2147483647)).expect(200);
    expect(reset.body).toEqual({ schemaVersion: 1, revision: 2147483648, layout: null });
    const loaded = await get().expect(200);
    expect(loaded.body).toEqual(reset.body);
    expect(typeof (reset.body as HomeLayoutResponseDto).revision).toBe('number');
    expect(typeof (loaded.body as HomeLayoutResponseDto).revision).toBe('number');
    const rows = await prisma.$queryRaw<
      { isNull: boolean }[]
    >`SELECT "layout" IS NULL AS "isNull" FROM "UserHomeLayout" WHERE "userId" = ${alice.userId}`;
    expect(rows).toEqual([{ isNull: true }]);
  });

  it('SC-Y11: 跨越舊上限後再帶舊 revision 回 409，資料不變', async () => {
    await seedRevision(2147483647);
    await put(body(DEFAULT_HOME_LAYOUT_V1, 2147483647)).expect(200);
    const before = await snapshot();
    const conflict = await put(body(nested, 2147483647)).expect(409);
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(await snapshot()).toBe(before);
    expect((await get().expect(200)).body).toEqual({
      schemaVersion: 1,
      revision: 2147483648,
      layout: DEFAULT_HOME_LAYOUT_V1,
    });
  });

  it('SC-Y11: 最大可接受 revision 儲存後精確回傳安全整數上限', async () => {
    await seedRevision(9007199254740990);
    const saved = await put(body(DEFAULT_HOME_LAYOUT_V1, 9007199254740990)).expect(200);
    const loaded = await get().expect(200);
    expect(saved.body).toEqual({
      schemaVersion: 1,
      revision: 9007199254740991,
      layout: DEFAULT_HOME_LAYOUT_V1,
    });
    expect(loaded.body).toEqual(saved.body);
    expect(typeof (saved.body as HomeLayoutResponseDto).revision).toBe('number');
    expect(typeof (loaded.body as HomeLayoutResponseDto).revision).toBe('number');
  });

  it.each([false, true])(
    'SC-Y11: Prisma 條件更新在已存在列 %s 不符合時實際丟 P2025',
    async (exists) => {
      if (exists) await put(body()).expect(200);
      const before = await snapshot();
      await expect(
        prisma.userHomeLayout.update({
          where: {
            userId_surface: { userId: alice.userId, surface: 'WEB' },
            revision: 2n,
          },
          data: { revision: { increment: 1 } },
          select: { schemaVersion: true, revision: true, layout: true },
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
      expect(await snapshot()).toBe(before);
      const conflict = await put(body(nested, 2)).expect(409);
      expect((conflict.body as ApiErrorResponse).errorCode).toBe(
        ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
      );
      expect(await snapshot()).toBe(before);
    },
  );

  it('SC-Y11: 資料列 revision 為 5 時帶 INTEGER 上限回 409，不回繞且資料不變', async () => {
    await seedRevision(5);
    const before = await snapshot();
    const conflict = await put(body(DEFAULT_HOME_LAYOUT_V1, 2147483647)).expect(409);
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(await snapshot()).toBe(before);
    expect((await get().expect(200)).body).toEqual({
      schemaVersion: 1,
      revision: 5,
      layout: nested,
    });
  });

  it.each([0, 1, 2147483647])('SC-Y11: 同時以 revision %i 儲存恰有一個成功', async (revision) => {
    if (revision > 0) await seedRevision(revision);
    const layouts = [nested, DEFAULT_HOME_LAYOUT_V1];
    const responses = await Promise.all(layouts.map((layout) => put(body(layout, revision))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200)!;
    expect(winner.body).toEqual({
      schemaVersion: 1,
      revision: revision + 1,
      layout: layouts[responses.indexOf(winner)],
    });
    expect(typeof (winner.body as HomeLayoutResponseDto).revision).toBe('number');
    expect(responses.find((response) => response.status === 409)!.body).toMatchObject({
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    const loaded = await get().expect(200);
    expect(loaded.body).toEqual(winner.body);
    expect(typeof (loaded.body as HomeLayoutResponseDto).revision).toBe('number');
    expect(await prisma.userHomeLayout.count()).toBe(1);
  });

  it('合法深層版面儲存讀回後，整棵樹與所有鍵均保留', async () => {
    await put(body()).expect(200);
    expect((await get().expect(200)).body).toEqual({
      schemaVersion: 1,
      revision: 1,
      layout: nested,
    });
    expect((await prisma.userHomeLayout.findMany())[0]?.layout).toEqual(nested);
  });

  const invalidCases: [string, () => unknown][] = [
    ['超過 16 KiB', () => ({ ...nested, note: '版'.repeat(6000) })],
    ['重複卡', () => ({ bands: [...nested.bands, { root: card('expense'), extraHeightPx: 0 }] })],
    [
      '缺一張卡',
      () => ({
        bands: [
          {
            root: split(
              'x',
              [
                card('expense'),
                card('income'),
                card('net'),
                card('trend'),
                card('categories'),
                card('activity'),
                card('accounts'),
              ],
              [1000, 1000, 1000, 1000, 1000, 1000, 4000],
            ),
            extraHeightPx: 0,
          },
        ],
      }),
    ],
    ['hiddenCardIds', () => ({ ...nested, hiddenCardIds: [] })],
    ['extraHeightPx 1601', () => ({ bands: [{ ...nested.bands[0], extraHeightPx: 1601 }] })],
  ];
  it.each(invalidCases)('SC-Y12: %s 回固定 400，資料庫完全不變', async (_name, invalid) => {
    await put(body()).expect(200);
    const before = await snapshot();
    const response = await put(body(invalid(), 1)).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      errorCode: ErrorCode.VALIDATION_FAILED,
      message: '版面格式不正確',
    });
    expect(await snapshot()).toBe(before);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'SC-Y12: 原始 JSON 的 %s 回固定 400，資料庫完全不變',
    async (key) => {
      await put(body()).expect(200);
      const before = await snapshot();
      // 原始 JSON 確保 __proto__ 是自有鍵；放在深層節點以驗證 guard 在 pipe 之前執行。
      const raw = JSON.stringify(body(nested, 1)).replace(
        '"cardId":"income"',
        `"cardId":"income","${key}":{}`,
      );
      const response = await request(httpServer(app))
        .put(path)
        .set(auth(alice.token))
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(400);
      expect(response.body).toEqual({
        statusCode: 400,
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: '版面格式不正確',
      });
      expect(await snapshot()).toBe(before);
    },
  );

  it.each([
    { schemaVersion: 2 },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: 9007199254740991 },
    { expectedRevision: '3' },
  ])('DTO 錯誤 %j 沿用 Validation failed 格式', async (invalid) => {
    await put(body()).expect(200);
    const before = await snapshot();
    const response = await put({ ...body(nested, 1), ...invalid }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      errorCode: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: expect.any(Array) as unknown,
    });
    expect((response.body as ApiErrorResponse).details?.length).toBeGreaterThan(0);
    expect(await snapshot()).toBe(before);
  });
});
