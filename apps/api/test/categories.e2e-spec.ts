import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Category, DEFAULT_CATEGORIES, LedgerSummary } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, firstLedgerId, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/** 圖示代號跨 HTTP、Prisma 與 migration 的驗證，使用真實測試資料庫。 */
describe('Category icons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('seeds every default category with its icon in a new ledger', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '圖示帳本' })
      .expect(201);
    const ledgerId = (created.body as LedgerSummary).id;
    const listed = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(alice.token))
      .expect(200);
    const categories = listed.body as Category[];
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
    for (const expected of DEFAULT_CATEGORIES) {
      expect(categories).toContainEqual(expect.objectContaining(expected));
    }
  });

  it('creates, edits and clears icons while preserving omitted fields', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const url = `/api/ledgers/${ledgerId}/categories`;

    const created = await request(server())
      .post(url)
      .set(auth(alice.token))
      .send({ name: '寵物', type: 'EXPENSE', icon: 'pet' })
      .expect(201);
    const category = created.body as Category;
    expect(category.icon).toBe('pet');

    const iconOnly = await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({ icon: 'gift' })
      .expect(200);
    expect(iconOnly.body as Category).toMatchObject({ name: '寵物', icon: 'gift' });

    const nameOnly = await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({ name: '毛孩' })
      .expect(200);
    expect(nameOnly.body as Category).toMatchObject({ name: '毛孩', icon: 'gift' });

    const cleared = await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({ icon: null })
      .expect(200);
    expect(cleared.body as Category).toMatchObject({ name: '毛孩', icon: null });

    const noIcon = await request(server())
      .post(url)
      .set(auth(alice.token))
      .send({ name: '臨時', type: 'EXPENSE' })
      .expect(201);
    expect((noIcon.body as Category).icon).toBeNull();

    await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({})
      .expect(400);
    await request(server())
      .post(url)
      .set(auth(alice.token))
      .send({ name: '錯誤', type: 'EXPENSE', icon: 'not-in-list' })
      .expect(400);
    await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({ icon: 'not-in-list' })
      .expect(400);
    await request(server())
      .patch(`${url}/${category.id}`)
      .set(auth(alice.token))
      .send({ name: null })
      .expect(400);
  });

  it('replays the migration backfill for matching null default categories only', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const food = await prisma.category.findFirstOrThrow({
      where: { ledgerId, name: '餐飲', type: 'EXPENSE' },
    });
    const transport = await prisma.category.findFirstOrThrow({
      where: { ledgerId, name: '交通', type: 'EXPENSE' },
    });
    await prisma.category.update({ where: { id: food.id }, data: { icon: null } });
    await prisma.category.update({ where: { id: transport.id }, data: { icon: 'gift' } });
    const sameNameWrongType = await prisma.category.create({
      data: { ledgerId, name: '餐飲', type: 'INCOME', icon: null },
    });

    // 直接執行 migration 檔中的 UPDATE，避免測試另寫一份相似但不相同的回填邏輯。
    const migration = readFileSync(
      resolve(__dirname, '../prisma/migrations/20261004000000_category_icons/migration.sql'),
      'utf8',
    );
    const updates = migration.match(
      /UPDATE "Category" SET "icon" = '[^']+' WHERE "name" = '[^']+' AND "type" = '[^']+' AND "icon" IS NULL;/g,
    );
    expect(updates).toHaveLength(DEFAULT_CATEGORIES.length);
    for (const sql of updates!) {
      await prisma.$executeRawUnsafe(sql);
    }

    expect((await prisma.category.findUniqueOrThrow({ where: { id: food.id } })).icon).toBe('food');
    expect((await prisma.category.findUniqueOrThrow({ where: { id: transport.id } })).icon).toBe(
      'gift',
    );
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: sameNameWrongType.id } })).icon,
    ).toBeNull();
  });
});
