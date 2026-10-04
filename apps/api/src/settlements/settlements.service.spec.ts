import { AppException } from '../common/exceptions/app.exception';
import type { LedgerPersonRecord } from '../ledger-people/ledger-people.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { SettlementsService } from './settlements.service';

/**
 * 驗證結清兩邊各自套用帳戶所有權、同一人拒絕、鎖定後只更新指定資料，
 * 以及 summary 將原始支出份額與結清交給 shared 計算。
 */
describe('SettlementsService', () => {
  const ledgerId = 'ledger-1';
  const callerId = 'alice-user';
  const date = '2026-10-04T12:00:00.000Z';
  const alice = makePerson('person-alice', callerId, 'Alice');
  const bob = makePerson('person-bob', 'bob-user', 'Bob');
  const charlie = makePerson('person-charlie', 'charlie-user', 'Charlie');
  const guest = makePerson('person-guest', null, 'Amei', 'GUEST');

  let service: SettlementsService;
  let tx: {
    ledger: { findUnique: jest.Mock };
    account: { findUnique: jest.Mock };
    transaction: { create: jest.Mock; update: jest.Mock };
    ledgerSettlement: { create: jest.Mock; update: jest.Mock };
    $queryRawUnsafe: jest.Mock;
  };
  let prisma: { $transaction: jest.Mock };
  let people: {
    findCallerPerson: jest.Mock;
    lockPeople: jest.Mock;
    listPeople: jest.Mock;
    toView: jest.Mock;
  };
  let transactions: { getById: jest.Mock };
  let records: Map<string, LedgerPersonRecord>;

  function makePerson(
    id: string,
    userId: string | null,
    name: string,
    status: LedgerPersonRecord['status'] = 'MEMBER',
  ): LedgerPersonRecord {
    return { id, ledgerId, userId, name, status, createdAt: new Date('2026-01-01T00:00:00Z') };
  }

  const lockedSettlement = {
    transactionId: 'transaction-1',
    settlementId: 'settlement-1',
    fromPersonId: bob.id,
    toPersonId: alice.id,
    accountId: null,
    toAccountId: 'account-alice',
    amount: 50000,
    date: new Date(date),
    note: null,
  };

  beforeEach(() => {
    records = new Map([
      [alice.id, alice],
      [bob.id, bob],
      [charlie.id, charlie],
      [guest.id, guest],
    ]);
    tx = {
      ledger: { findUnique: jest.fn().mockResolvedValue({ kind: 'SHARED', tracksBalance: true }) },
      account: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => ({
          userId: where.id === 'account-foreign' ? 'bob-user' : callerId,
        })),
      },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
        update: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
      },
      ledgerSettlement: {
        create: jest.fn().mockResolvedValue({ id: 'settlement-1' }),
        update: jest.fn().mockResolvedValue({ id: 'settlement-1' }),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([lockedSettlement]),
    };
    prisma = {
      $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) => callback(tx)),
    };
    people = {
      findCallerPerson: jest.fn().mockResolvedValue(alice),
      lockPeople: jest
        .fn()
        .mockImplementation(
          (_client: unknown, _ledger: string, ids: string[]) =>
            new Map(ids.map((id) => [id, records.get(id)!])),
        ),
      listPeople: jest.fn().mockResolvedValue([]),
      toView: jest.fn((person: LedgerPersonRecord) => ({
        id: person.id,
        name: person.name,
        userId: person.userId,
        status: person.status,
      })),
    };
    transactions = {
      getById: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
    };
    service = new SettlementsService(
      prisma as unknown as PrismaService,
      people as unknown as LedgerPeopleService,
      transactions as unknown as TransactionsService,
    );
  });

  describe('create account rules', () => {
    it.each([
      {
        label: 'the caller pays and selects only their account',
        fromPersonId: undefined,
        toPersonId: bob.id,
        fromAccountId: 'account-alice',
        toAccountId: undefined,
        expectedAccountId: 'account-alice',
        expectedToAccountId: null,
      },
      {
        label: 'the caller receives and selects only their account',
        fromPersonId: bob.id,
        toPersonId: alice.id,
        fromAccountId: undefined,
        toAccountId: 'account-alice',
        expectedAccountId: null,
        expectedToAccountId: 'account-alice',
      },
      {
        label: 'two other members settle without account ids',
        fromPersonId: bob.id,
        toPersonId: charlie.id,
        fromAccountId: undefined,
        toAccountId: undefined,
        expectedAccountId: null,
        expectedToAccountId: null,
      },
      {
        label: 'a guest pays and the caller selects the receiving account',
        fromPersonId: guest.id,
        toPersonId: alice.id,
        fromAccountId: undefined,
        toAccountId: 'account-alice',
        expectedAccountId: null,
        expectedToAccountId: 'account-alice',
      },
    ])('$label', async (testCase) => {
      await service.create(ledgerId, callerId, {
        ...(testCase.fromPersonId ? { fromPersonId: testCase.fromPersonId } : {}),
        toPersonId: testCase.toPersonId,
        amount: 50000,
        date,
        ...(testCase.fromAccountId ? { fromAccountId: testCase.fromAccountId } : {}),
        ...(testCase.toAccountId ? { toAccountId: testCase.toAccountId } : {}),
      });

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TRANSFER',
            accountId: testCase.expectedAccountId,
            toAccountId: testCase.expectedToAccountId,
            creatorId: callerId,
          }) as unknown,
        }),
      );
      expect(tx.ledgerSettlement.create).toHaveBeenCalledWith({
        data: {
          transactionId: 'transaction-1',
          fromPersonId: testCase.fromPersonId ?? alice.id,
          toPersonId: testCase.toPersonId,
        },
      });
      expect(people.lockPeople).toHaveBeenCalledWith(
        tx,
        ledgerId,
        [testCase.fromPersonId ?? alice.id, testCase.toPersonId],
        { allowLeft: true },
      );
      expect(transactions.getById).toHaveBeenCalledWith(ledgerId, 'transaction-1', callerId);
    });

    it('rejects the same person without writing either row', async () => {
      await expect(
        service.create(ledgerId, callerId, {
          toPersonId: alice.id,
          amount: 100,
          date,
          fromAccountId: 'account-alice',
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'SETTLEMENT_SAME_PERSON' });

      expect(tx.transaction.create).not.toHaveBeenCalled();
      expect(tx.ledgerSettlement.create).not.toHaveBeenCalled();
    });

    it('requires an account when the caller is either side in a tracking ledger', async () => {
      await expect(
        service.create(ledgerId, callerId, { toPersonId: bob.id, amount: 100, date }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });
      await expect(
        service.create(ledgerId, callerId, {
          fromPersonId: bob.id,
          toPersonId: alice.id,
          amount: 100,
          date,
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });

      expect(tx.transaction.create).not.toHaveBeenCalled();
      expect(tx.ledgerSettlement.create).not.toHaveBeenCalled();
    });

    it('rejects an account selected for another payer and a foreign account', async () => {
      await expect(
        service.create(ledgerId, callerId, {
          fromPersonId: bob.id,
          toPersonId: alice.id,
          amount: 100,
          date,
          fromAccountId: 'account-bob',
          toAccountId: 'account-alice',
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_NOT_PAYERS' });

      await expect(
        service.create(ledgerId, callerId, {
          toPersonId: bob.id,
          amount: 100,
          date,
          fromAccountId: 'account-foreign',
        }),
      ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });

      expect(tx.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects account ids for a non-tracking ledger and accepts a settlement without them', async () => {
      tx.ledger.findUnique.mockResolvedValue({ kind: 'SHARED', tracksBalance: false });
      await expect(
        service.create(ledgerId, callerId, {
          toPersonId: bob.id,
          amount: 100,
          date,
          fromAccountId: 'account-alice',
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_NOT_ALLOWED' });
      expect(tx.transaction.create).not.toHaveBeenCalled();

      await service.create(ledgerId, callerId, { toPersonId: bob.id, amount: 100, date });
      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountId: null, toAccountId: null }) as unknown,
        }),
      );
    });
  });

  describe('updates and account completion', () => {
    it('clears the receiving account when that person changes', async () => {
      await service.update(ledgerId, 'settlement-1', callerId, { toPersonId: guest.id });

      expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE OF t'),
        'settlement-1',
        ledgerId,
      );
      expect(tx.transaction.update).toHaveBeenCalledWith({
        where: { id: 'transaction-1' },
        data: { toAccountId: null },
      });
      expect(tx.ledgerSettlement.update).toHaveBeenCalledWith({
        where: { id: 'settlement-1' },
        data: { toPersonId: guest.id },
      });
      expect(people.lockPeople).toHaveBeenCalledWith(tx, ledgerId, [bob.id, guest.id], {
        allowLeft: true,
      });
    });

    it('requires the caller account when changing a side to the caller', async () => {
      tx.$queryRawUnsafe.mockResolvedValueOnce([
        { ...lockedSettlement, toPersonId: charlie.id, toAccountId: null },
      ]);
      await expect(
        service.update(ledgerId, 'settlement-1', callerId, { fromPersonId: alice.id }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });

      expect(tx.transaction.update).not.toHaveBeenCalled();
      expect(tx.ledgerSettlement.update).not.toHaveBeenCalled();
    });

    it('rejects a patch that changes both sides to the same person', async () => {
      await expect(
        service.update(ledgerId, 'settlement-1', callerId, { toPersonId: bob.id }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'SETTLEMENT_SAME_PERSON' });

      expect(tx.transaction.update).not.toHaveBeenCalled();
      expect(tx.ledgerSettlement.update).not.toHaveBeenCalled();
    });

    it('lets the receiving person complete only their transfer account', async () => {
      await service.setAccount(ledgerId, 'settlement-1', callerId, 'account-alice');

      expect(tx.transaction.update).toHaveBeenCalledWith({
        where: { id: 'transaction-1' },
        data: { toAccountId: 'account-alice' },
      });
      expect(transactions.getById).toHaveBeenCalledWith(ledgerId, 'transaction-1', callerId);
    });

    it('rejects an unrelated person completing an account', async () => {
      await expect(
        service.setAccount(ledgerId, 'settlement-1', 'charlie-user', 'account-charlie'),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_NOT_PAYERS' });
      expect(tx.transaction.update).not.toHaveBeenCalled();
    });
  });

  describe('summary assembly', () => {
    it('computes balances from split shares and includes left and unused people', async () => {
      const leftBob = { ...bob, status: 'LEFT' as const };
      records.set(bob.id, leftBob);
      people.listPeople.mockResolvedValue([alice, leftBob, charlie, guest]);
      const splitRows = [
        {
          transactionId: 'room',
          type: 'EXPENSE',
          amount: 600000,
          payerId: alice.id,
          personId: alice.id,
          share: 200000,
        },
        {
          transactionId: 'room',
          type: 'EXPENSE',
          amount: 600000,
          payerId: alice.id,
          personId: bob.id,
          share: 200000,
        },
        {
          transactionId: 'room',
          type: 'EXPENSE',
          amount: 600000,
          payerId: alice.id,
          personId: charlie.id,
          share: 200000,
        },
        {
          transactionId: 'dinner',
          type: 'EXPENSE',
          amount: 150000,
          payerId: bob.id,
          personId: alice.id,
          share: 50000,
        },
        {
          transactionId: 'dinner',
          type: 'EXPENSE',
          amount: 150000,
          payerId: bob.id,
          personId: bob.id,
          share: 50000,
        },
        {
          transactionId: 'dinner',
          type: 'EXPENSE',
          amount: 150000,
          payerId: bob.id,
          personId: charlie.id,
          share: 50000,
        },
        {
          transactionId: 'gas',
          type: 'EXPENSE',
          amount: 90000,
          payerId: charlie.id,
          personId: alice.id,
          share: 45000,
        },
        {
          transactionId: 'gas',
          type: 'EXPENSE',
          amount: 90000,
          payerId: charlie.id,
          personId: charlie.id,
          share: 45000,
        },
      ];
      tx.$queryRawUnsafe.mockResolvedValueOnce(splitRows).mockResolvedValueOnce([]);

      const result = await service.summary(ledgerId);

      expect(result.people.map(({ person, net }) => [person.id, person.status, net])).toEqual([
        [alice.id, 'MEMBER', 305000],
        [bob.id, 'LEFT', -100000],
        [charlie.id, 'MEMBER', -205000],
        [guest.id, 'GUEST', 0],
      ]);
      expect(result.suggestions).toEqual([
        { fromPersonId: charlie.id, toPersonId: alice.id, amount: 205000 },
        { fromPersonId: bob.id, toPersonId: alice.id, amount: 100000 },
      ]);
      expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('COALESCE(t."payerPersonId", creator."id")'),
        ledgerId,
      );
      expect(tx.$queryRawUnsafe).toHaveBeenNthCalledWith(
        1,
        expect.not.stringMatching(/SUM|CASE/i),
        ledgerId,
      );
    });
  });

  it('returns 404 for personal ledgers', async () => {
    tx.ledger.findUnique.mockResolvedValue({ kind: 'PERSONAL', tracksBalance: true });

    await expect(service.summary(ledgerId)).rejects.toMatchObject({
      constructor: AppException,
      status: 404,
      errorCode: 'NOT_FOUND',
    });
    expect(people.listPeople).not.toHaveBeenCalled();
  });
});
