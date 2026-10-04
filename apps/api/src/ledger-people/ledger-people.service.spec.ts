import { Prisma } from '../generated/prisma/client';
import { LedgerPeopleService } from './ledger-people.service';

describe('LedgerPeopleService', () => {
  const service = new LedgerPeopleService();
  const date = new Date('2026-01-01T00:00:00Z');
  const member = {
    id: 'a',
    ledgerId: 'ledger',
    userId: 'user',
    name: null,
    deletedAt: null,
    createdAt: date,
  };
  const guest = {
    id: 'b',
    ledgerId: 'ledger',
    userId: null,
    name: 'Guest',
    deletedAt: null,
    createdAt: date,
  };
  const tx = {
    ledgerPerson: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    ledgerMember: { findUnique: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const client = tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findMany.mockResolvedValue([{ id: 'user', name: 'Member' }]);
    tx.ledgerMember.findMany.mockResolvedValue([{ userId: 'user' }]);
  });

  it('upserts members using the stable ledger and user key', async () => {
    await service.ensureMemberPerson(client, 'ledger', 'user');
    expect(tx.ledgerPerson.upsert).toHaveBeenCalledWith({
      where: { ledgerId_userId: { ledgerId: 'ledger', userId: 'user' } },
      create: { ledgerId: 'ledger', userId: 'user' },
      update: {},
    });
  });

  it('finds the caller and derives the left status after membership removal', async () => {
    tx.ledgerPerson.findUnique.mockResolvedValue(member);
    tx.user.findUnique.mockResolvedValue({ name: 'Member' });
    tx.ledgerMember.findUnique.mockResolvedValue(null);
    expect(await service.findCallerPerson(client, 'ledger', 'user')).toMatchObject({
      name: 'Member',
      status: 'LEFT',
    });
    tx.ledgerPerson.findUnique.mockResolvedValue(null);
    expect(await service.findCallerPerson(client, 'ledger', 'absent')).toBeNull();
  });

  it('locks unique ids in sorted order and maps member and guest views', async () => {
    tx.$queryRaw.mockResolvedValueOnce([member]).mockResolvedValueOnce([guest]);
    const found = await service.lockPeople(client, 'ledger', ['b', 'a', 'b'], { allowLeft: false });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect([...found.keys()]).toEqual(['a', 'b']);
    expect(service.toView(found.get('a')!)).toEqual({
      id: 'a',
      name: 'Member',
      userId: 'user',
      status: 'MEMBER',
    });
    expect(found.get('b')?.status).toBe('GUEST');
  });

  it('hides foreign ids and rejects deleted guests or left members unless allowed', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.lockPeople(client, 'ledger', ['foreign'], { allowLeft: false }),
    ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
    tx.$queryRaw.mockResolvedValueOnce([{ ...guest, deletedAt: date }]);
    await expect(
      service.lockPeople(client, 'ledger', ['b'], { allowLeft: true }),
    ).rejects.toMatchObject({ status: 400, errorCode: 'LEDGER_PERSON_NOT_SELECTABLE' });
    tx.ledgerMember.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValueOnce([member]);
    await expect(
      service.lockPeople(client, 'ledger', ['a'], { allowLeft: false }),
    ).rejects.toMatchObject({ status: 400, errorCode: 'LEDGER_PERSON_NOT_SELECTABLE' });
    tx.$queryRaw.mockResolvedValueOnce([member]);
    expect(
      (await service.lockPeople(client, 'ledger', ['a'], { allowLeft: new Set(['a']) })).get('a')
        ?.status,
    ).toBe('LEFT');
  });

  it('locks deletion with FOR UPDATE and lists people by creation order', async () => {
    tx.$queryRaw.mockResolvedValueOnce([guest]);
    expect((await service.lockForDelete(client, 'ledger', 'b')).status).toBe('GUEST');
    tx.ledgerPerson.findMany.mockResolvedValue([member, guest]);
    expect((await service.listPeople(client, 'ledger')).map((p) => p.id)).toEqual(['a', 'b']);
    expect(tx.ledgerPerson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });
});
