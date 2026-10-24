import { INestApplication } from '@nestjs/common';
import type { Category, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * SC-P14 的新增分類寫入契約：以真正 HTTP 與資料庫驗證排序、同名重用、輸入邊界與併發。
 * 原子性與授權由協調者的 isolation suite 驗證；這裡同時涵蓋個人及共享帳本成功路徑。
 */
describe('Create transaction with a new category (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Person;
  const DATE = '2026-10-24T12:00:00.000Z';
  const NAME = '日用品';
  const server = () => httpServer(app);

  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(async () => {
    await resetDb(prisma);
    owner = await person(app, 'owner@example.com', 'Owner');
  });
  afterAll(() => app.close());

  function create(ledgerId: string, body: Record<string, unknown> = {}) {
    return request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(owner.token))
      .send({
        type: 'EXPENSE',
        amount: 18900,
        date: DATE,
        accountId: owner.cashId,
        newCategoryName: NAME,
        ...body,
      });
  }

  async function addCategory(ledgerId: string, name: string, type = 'EXPENSE') {
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/categories`)
      .set(auth(owner.token))
      .send({ name, type, icon: 'food' })
      .expect(201);
    return res.body as Category;
  }

  it.each(['PERSONAL', 'SHARED'] as const)(
    'creates an iconless category last in its type in a %s ledger',
    async (kind) => {
      const ledgerId =
        kind === 'PERSONAL' ? owner.ledgerId : await createSharedLedger(app, owner.token);
      await addCategory(ledgerId, '前一個支出分類');
      const previous = await prisma.category.findMany({ where: { ledgerId, type: 'EXPENSE' } });
      const before = await prisma.category.count({ where: { ledgerId } });

      const res = await create(ledgerId, { newCategoryName: `  ${NAME}  ` }).expect(201);
      const category = await prisma.category.findUniqueOrThrow({
        where: { ledgerId_type_name: { ledgerId, type: 'EXPENSE', name: NAME } },
      });

      expect(category.icon).toBeNull();
      expect(category.sortOrder).toBe(Math.max(...previous.map((item) => item.sortOrder)) + 1);
      expect((res.body as Transaction).category).toEqual({
        id: category.id,
        name: NAME,
        icon: null,
      });
      expect(await prisma.category.count({ where: { ledgerId } })).toBe(before + 1);
      expect(await prisma.transaction.count({ where: { ledgerId, categoryId: category.id } })).toBe(
        1,
      );
    },
  );

  it('reuses the exact existing name and preserves its icon and sort order', async () => {
    const category = await addCategory(owner.ledgerId, NAME);
    const before = await prisma.category.count({ where: { ledgerId: owner.ledgerId } });
    const res = await create(owner.ledgerId, { newCategoryName: ` ${NAME} ` }).expect(201);
    expect((res.body as Transaction).category).toEqual({
      id: category.id,
      name: NAME,
      icon: 'food',
    });
    expect(await prisma.category.count({ where: { ledgerId: owner.ledgerId } })).toBe(before);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({
      icon: 'food',
      sortOrder: category.sortOrder,
    });
  });

  it('creates a different category when the same name belongs to the other type', async () => {
    const expense = await addCategory(owner.ledgerId, NAME);
    const before = await prisma.category.count({ where: { ledgerId: owner.ledgerId } });
    const res = await create(owner.ledgerId, { type: 'INCOME' }).expect(201);
    const income = await prisma.category.findUniqueOrThrow({
      where: { ledgerId_type_name: { ledgerId: owner.ledgerId, type: 'INCOME', name: NAME } },
    });
    expect(income.id).not.toBe(expense.id);
    expect((res.body as Transaction).category?.id).toBe(income.id);
    expect(await prisma.category.count({ where: { ledgerId: owner.ledgerId } })).toBe(before + 1);
  });

  it('matches names case-sensitively', async () => {
    const upper = await addCategory(owner.ledgerId, 'Travel');
    const res = await create(owner.ledgerId, { newCategoryName: 'travel' }).expect(201);
    expect((res.body as Transaction).category?.id).not.toBe(upper.id);
    expect(
      await prisma.category.count({
        where: { ledgerId: owner.ledgerId, name: { in: ['Travel', 'travel'] } },
      }),
    ).toBe(2);
  });

  it.each([
    ['both fields', { categoryId: '00000000-0000-4000-8000-000000000000' }],
    ['neither field', { newCategoryName: undefined }],
    ['whitespace', { newCategoryName: ' \t\n ' }],
    ['51 characters', { newCategoryName: 'a'.repeat(51) }],
    ['a non-string', { newCategoryName: 123 }],
    ['null', { newCategoryName: null }],
  ] as const)('rejects %s without creating a category or transaction', async (_label, body) => {
    const before = await prisma.category.count({ where: { ledgerId: owner.ledgerId } });
    const res = await create(owner.ledgerId, body).expect(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_FAILED');
    expect(await prisma.category.count({ where: { ledgerId: owner.ledgerId } })).toBe(before);
    expect(await prisma.transaction.count({ where: { ledgerId: owner.ledgerId } })).toBe(0);
  });

  it('rejects a transfer with a new category without creating anything', async () => {
    const account = await request(server())
      .post('/api/accounts')
      .set(auth(owner.token))
      .send({ name: 'Bank' })
      .expect(201);
    const before = await prisma.category.count({ where: { ledgerId: owner.ledgerId } });
    const res = await create(owner.ledgerId, {
      type: 'TRANSFER',
      toAccountId: (account.body as { id: string }).id,
    }).expect(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_FAILED');
    expect(await prisma.category.count({ where: { ledgerId: owner.ledgerId } })).toBe(before);
    expect(await prisma.transaction.count({ where: { ledgerId: owner.ledgerId } })).toBe(0);
  });

  it.each(['a', '😀'])('accepts 50 %s characters after trimming', async (character) => {
    const name = character.repeat(50);
    const res = await create(owner.ledgerId, { newCategoryName: `  ${name}  ` }).expect(201);
    expect((res.body as Transaction).category?.name).toBe(name);
  });

  it.each(['PERSONAL', 'SHARED'] as const)(
    'creates two transactions but only one category for concurrent %s requests',
    async (kind) => {
      const ledgerId =
        kind === 'PERSONAL' ? owner.ledgerId : await createSharedLedger(app, owner.token);
      const results = await Promise.all([
        create(ledgerId).expect(201),
        create(ledgerId).expect(201),
      ]);
      const categories = await prisma.category.findMany({
        where: { ledgerId, type: 'EXPENSE', name: NAME },
      });
      expect(categories).toHaveLength(1);
      const categoryId = categories[0]!.id;
      expect(results.map((res) => (res.body as Transaction).category?.id)).toEqual([
        categoryId,
        categoryId,
      ]);
      expect(new Set(results.map((res) => (res.body as Transaction).id)).size).toBe(2);
      expect(await prisma.transaction.count({ where: { ledgerId, categoryId } })).toBe(2);
    },
  );
});
