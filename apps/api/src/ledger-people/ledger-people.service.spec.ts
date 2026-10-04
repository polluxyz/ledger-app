import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPeopleService } from './ledger-people.service';

describe('LedgerPeopleService', () => {
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
    ledger: { findUnique: jest.fn() },
    ledgerPerson: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    ledgerMember: { findUnique: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const client = tx as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(client),
    ),
  };
  const service = new LedgerPeopleService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ledger.findUnique.mockResolvedValue({ kind: 'SHARED' });
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

  it('lists the shared ledger people through the existing mapper', async () => {
    tx.ledgerPerson.findMany.mockResolvedValue([member, guest]);

    await expect(service.list('ledger')).resolves.toEqual([
      { id: 'a', name: 'Member', userId: 'user', status: 'MEMBER' },
      { id: 'b', name: 'Guest', userId: null, status: 'GUEST' },
    ]);
    expect(tx.ledger.findUnique).toHaveBeenCalledWith({
      where: { id: 'ledger' },
      select: { kind: true },
    });
  });

  it('normalizes a new guest name and maps a concurrent unique-index conflict', async () => {
    tx.ledgerPerson.findFirst.mockResolvedValue(null);
    tx.ledgerPerson.create.mockResolvedValue({ ...guest, name: 'Amie' });

    await expect(service.createGuest('ledger', '  Amie  ')).resolves.toEqual({
      id: 'b',
      name: 'Amie',
      userId: null,
      status: 'GUEST',
    });
    expect(tx.ledgerPerson.create).toHaveBeenCalledWith({
      data: { ledgerId: 'ledger', userId: null, name: 'Amie' },
    });

    tx.ledgerPerson.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'unit-test',
      }),
    );
    await expect(service.createGuest('ledger', 'Amie')).rejects.toMatchObject({
      status: 409,
      errorCode: 'LEDGER_PERSON_NAME_TAKEN',
    });
  });

  it('returns 404 for personal ledgers and soft-deleted guest ids', async () => {
    tx.ledger.findUnique.mockResolvedValueOnce({ kind: 'PERSONAL' });
    await expect(service.list('ledger')).rejects.toMatchObject({
      status: 404,
      errorCode: 'NOT_FOUND',
    });

    tx.ledger.findUnique.mockResolvedValueOnce({ kind: 'SHARED' });
    tx.$queryRaw.mockResolvedValueOnce([{ ...guest, deletedAt: date }]);
    await expect(service.renameGuest('ledger', 'b', 'New name')).rejects.toMatchObject({
      status: 404,
      errorCode: 'NOT_FOUND',
    });
  });
});
