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
    };
    transaction: { count: jest.Mock };
  };

  const ledgerId = 'ledger-1';
  const row = {
    id: 'cat-1',
    ledgerId,
    name: '餐飲',
    type: 'EXPENSE' as const,
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
      },
      transaction: { count: jest.fn() },
    };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  it('creates a category', async () => {
    prisma.category.create.mockResolvedValue(row);

    await expect(service.create(ledgerId, '餐飲', 'EXPENSE')).resolves.toEqual({
      id: 'cat-1',
      name: '餐飲',
      type: 'EXPENSE',
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
      orderBy: { createdAt: 'asc' },
    });
  });
});
