import { PrismaService } from '../prisma/prisma.service';
import { LedgerPointersService } from './ledger-pointers.service';

/** 服務層在寫入前重驗授權與歸屬，並以真正的 batch loader 回傳設定後結果。 */
describe('LedgerPointersService', () => {
  const userId = 'me';
  const ledgerId = 'ledger';
  const personId = 'person';
  const tx = {
    ledgerMember: { findUnique: jest.fn() },
    ledgerPerson: { findFirst: jest.fn(), findMany: jest.fn() },
    counterparty: { findFirst: jest.fn() },
    ledgerPersonPointer: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    counterpartyLink: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaService;
  const service = new LedgerPointersService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ledgerMember.findUnique.mockResolvedValue({ userId });
    tx.ledgerPerson.findFirst.mockResolvedValue({ userId: 'other' });
    tx.ledgerPerson.findMany.mockResolvedValue([{ id: personId, userId: 'other' }]);
    tx.counterparty.findFirst.mockResolvedValue({ id: 'mine' });
    tx.ledgerPersonPointer.findMany.mockResolvedValue([
      { ledgerPersonId: personId, counterpartyId: 'mine' },
    ]);
    tx.counterpartyLink.findMany.mockResolvedValue([]);
    tx.ledgerPersonPointer.upsert.mockResolvedValue({});
    tx.ledgerPersonPointer.deleteMany.mockResolvedValue({ count: 0 });
  });

  it.each([
    ['caller is not a member', 'ledgerMember', null, 404],
    ['person is outside the ledger or deleted', 'ledgerPerson', null, 404],
    ['person is caller', 'ledgerPerson', { userId }, 400],
    ['counterparty belongs to someone else', 'counterparty', null, 404],
  ] as const)('rejects when %s before writing', async (_name, target, result, status) => {
    if (target === 'ledgerMember') tx.ledgerMember.findUnique.mockResolvedValue(result);
    if (target === 'ledgerPerson') tx.ledgerPerson.findFirst.mockResolvedValue(result);
    if (target === 'counterparty') tx.counterparty.findFirst.mockResolvedValue(result);
    await expect(service.set(userId, ledgerId, personId, 'mine')).rejects.toMatchObject({
      status,
      ...(status === 400 ? { errorCode: 'VALIDATION_FAILED' } : {}),
    });
    expect(tx.ledgerPersonPointer.upsert).not.toHaveBeenCalled();
  });

  it('upserts the caller-owned pointer', async () => {
    await expect(service.set(userId, ledgerId, personId, 'mine')).resolves.toEqual({
      counterpartyId: 'mine',
      auto: false,
    });
    expect(tx.ledgerPersonPointer.upsert).toHaveBeenCalledWith({
      where: { userId_ledgerPersonId: { userId, ledgerPersonId: personId } },
      create: { userId, ledgerPersonId: personId, counterpartyId: 'mine' },
      update: { counterpartyId: 'mine' },
    });
  });

  it('DELETE is idempotent and restores automatic selection', async () => {
    tx.ledgerPersonPointer.findMany.mockResolvedValue([]);
    tx.counterpartyLink.findMany.mockResolvedValue([
      {
        userLowId: userId,
        userHighId: 'other',
        counterpartyLowId: 'linked',
        counterpartyHighId: 'theirs',
      },
    ]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.remove(userId, ledgerId, personId)).resolves.toEqual({
        counterpartyId: 'linked',
        auto: true,
      });
    }
    expect(tx.ledgerPersonPointer.deleteMany).toHaveBeenCalledTimes(2);
  });
});
