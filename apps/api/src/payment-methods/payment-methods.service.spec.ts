import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * PaymentMethodsService 的單元測試（Prisma 全程 mock）：建立、重複名稱對應
 * PAYMENT_METHOD_NAME_TAKEN、跨帳本改名回 404、有交易引用時不可刪、無引用可刪、
 * 依帳本列表。形狀比照 CategoriesService 的測試。
 */
describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let prisma: {
    paymentMethod: {
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
    id: 'pm-1',
    ledgerId,
    name: '現金',
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
  };
  const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

  beforeEach(() => {
    prisma = {
      paymentMethod: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      transaction: { count: jest.fn() },
    };
    service = new PaymentMethodsService(prisma as unknown as PrismaService);
  });

  it('creates a payment method', async () => {
    prisma.paymentMethod.create.mockResolvedValue(row);

    await expect(service.create(ledgerId, '現金')).resolves.toEqual({
      id: 'pm-1',
      name: '現金',
      createdAt: row.createdAt.toISOString(),
    });
  });

  it('maps a duplicate name to 409 PAYMENT_METHOD_NAME_TAKEN', async () => {
    prisma.paymentMethod.create.mockRejectedValue(p2002);

    await expect(service.create(ledgerId, '現金')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'PAYMENT_METHOD_NAME_TAKEN',
    });
  });

  it('404s when renaming a payment method from another ledger', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue({
      ...row,
      ledgerId: 'other-ledger',
    });

    await expect(service.rename(ledgerId, 'pm-1', '零錢')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
  });

  it('maps a duplicate name on rename to 409', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue(row);
    prisma.paymentMethod.update.mockRejectedValue(p2002);

    await expect(service.rename(ledgerId, 'pm-1', '信用卡')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'PAYMENT_METHOD_NAME_TAKEN',
    });
  });

  it('blocks deleting a payment method that transactions reference', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(2);

    await expect(service.remove(ledgerId, 'pm-1')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'PAYMENT_METHOD_IN_USE',
    });
    expect(prisma.paymentMethod.delete).not.toHaveBeenCalled();
  });

  it('counts soft-deleted transactions as references too', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(0);

    await service.remove(ledgerId, 'pm-1');

    // 不帶 deletedAt 過濾：軟刪除的交易同樣算引用，歷史須保持可追溯。
    expect(prisma.transaction.count).toHaveBeenCalledWith({
      where: { paymentMethodId: 'pm-1' },
    });
  });

  it('deletes a payment method with no referencing transactions', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(0);

    await service.remove(ledgerId, 'pm-1');

    expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({
      where: { id: 'pm-1' },
    });
  });

  it('lists a ledger payment methods oldest first', async () => {
    prisma.paymentMethod.findMany.mockResolvedValue([row]);

    await service.list(ledgerId);

    expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
      where: { ledgerId },
      orderBy: { createdAt: 'asc' },
    });
  });
});
