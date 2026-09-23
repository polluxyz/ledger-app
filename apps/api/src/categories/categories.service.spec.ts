import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

/**
 * CategoriesService 的單元測試（Prisma 全程 mock）：建立、重複名稱對應
 * CATEGORY_NAME_TAKEN、跨帳本改名回 404、有交易引用時不可刪、無引用可刪、
 * 列表依型別篩選。
 */
describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: {
    category: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findFirst: jest.Mock;
    };
    transaction: { count: jest.Mock };
  };

  const ledgerId = 'ledger-1';
  const row = {
    id: 'cat-1',
    ledgerId,
    name: '餐飲',
    type: 'EXPENSE' as const,
    sortOrder: 0,
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
  };
  const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
      },
      transaction: { count: jest.fn() },
    };
    // Prisma 的 findFirst 找不到時回 null（不是 undefined）。沒有這行，
    // 沒特別安排 findFirst 的測試會拿到 jest.fn() 預設的 undefined，
    // 那是真實 Prisma 不會出現的值，測出來的行為也就不算數。
    prisma.category.findFirst.mockResolvedValue(null);
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  it('creates a category', async () => {
    prisma.category.create.mockResolvedValue(row);

    await expect(service.create(ledgerId, '餐飲', 'EXPENSE')).resolves.toEqual({
      id: 'cat-1',
      name: '餐飲',
      type: 'EXPENSE',
      sortOrder: 0,
      createdAt: row.createdAt.toISOString(),
    });
  });

  it('maps a duplicate name to 409 CATEGORY_NAME_TAKEN', async () => {
    prisma.category.create.mockRejectedValue(p2002);

    await expect(service.create(ledgerId, '餐飲', 'EXPENSE')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'CATEGORY_NAME_TAKEN',
    });
  });

  it('404s when renaming a category from another ledger', async () => {
    prisma.category.findUnique.mockResolvedValue({
      ...row,
      ledgerId: 'other-ledger',
    });

    await expect(service.rename(ledgerId, 'cat-1', '飲食')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('blocks deleting a category that transactions reference', async () => {
    prisma.category.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(3);

    await expect(service.remove(ledgerId, 'cat-1')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'CATEGORY_IN_USE',
    });
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('deletes a category with no referencing transactions', async () => {
    prisma.category.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(0);

    await service.remove(ledgerId, 'cat-1');

    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
    });
  });

  it('filters by type when listing', async () => {
    prisma.category.findMany.mockResolvedValue([row]);

    await service.list(ledgerId, 'EXPENSE');

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { ledgerId, type: 'EXPENSE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  /**
   * 排序（2g）。預設分類是 `createMany` 一次寫入的，時間戳全部相同，所以
   * 靠 `createdAt` 排會得到沒有確定結果的順序——同一組分類在不同帳本排法不同。
   * 下面兩條釘住取而代之的規則。
   */
  it('orders by sortOrder first and falls back to name', async () => {
    prisma.category.findMany.mockResolvedValue([]);

    await service.list(ledgerId);

    // 次要鍵不是裝飾：`sortOrder` 加上去之前就存在的分類全是預設值 0。
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { ledgerId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('appends a new category after the last one of the same type', async () => {
    prisma.category.findFirst.mockResolvedValue({ sortOrder: 7 });
    prisma.category.create.mockResolvedValue({ ...row, sortOrder: 8 });

    await service.create(ledgerId, '寵物', 'EXPENSE');

    // 只看同一帳本、同一型別的最大值——支出與收入各自從 0 開始數。
    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: { ledgerId, type: 'EXPENSE' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { ledgerId, name: '寵物', type: 'EXPENSE', sortOrder: 8 },
    });
  });

  it('starts at 0 when the type has no categories yet', async () => {
    prisma.category.findFirst.mockResolvedValue(null);
    prisma.category.create.mockResolvedValue(row);

    await service.create(ledgerId, '薪資', 'INCOME');

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { ledgerId, name: '薪資', type: 'INCOME', sortOrder: 0 },
    });
  });
});
