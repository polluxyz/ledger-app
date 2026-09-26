import {
  establishLink,
  linkInfoFor,
  otherSide,
  ownSideCounterparty,
  unlinkUsers,
} from './counterparty-links';
import { toCounterparty } from './debt-entry-rules';

/**
 * 連動的共用函式（spec 3b-2 決策 56～60）。
 *
 * 只驗不需要資料庫的部分：從哪一側看連動、接受時的「二選一」、對方餘額的換角度。
 * 建立與解除連動牽涉多張表與交易，由 `debt-linking.e2e-spec.ts` 對真的 PostgreSQL 驗。
 */
describe('counterparty links', () => {
  const link = {
    id: 'link-1',
    userLowId: 'alice',
    userHighId: 'bob',
    counterpartyLowId: 'cp-alice',
    counterpartyHighId: 'cp-bob',
    createdAt: new Date(),
  };

  it('reads the other side from either counterparty', () => {
    expect(otherSide(link, 'cp-alice')).toEqual({ userId: 'bob', counterpartyId: 'cp-bob' });
    expect(otherSide(link, 'cp-bob')).toEqual({ userId: 'alice', counterpartyId: 'cp-alice' });
    expect(ownSideCounterparty(link, 'alice')).toBe('cp-alice');
    expect(ownSideCounterparty(link, 'bob')).toBe('cp-bob');
  });

  it('uses the linked account name only when no nickname is set', () => {
    const row = {
      id: 'cp-alice',
      ownerId: 'alice',
      name: null,
      askMerge: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(
      toCounterparty(row, 0, { userId: 'bob', userName: 'Bob', theirBalance: 0 }),
    ).toMatchObject({
      name: null,
      displayName: 'Bob',
      askMerge: true,
    });
    expect(
      toCounterparty({ ...row, name: '小明' }, 0, {
        userId: 'bob',
        userName: 'Bob',
        theirBalance: 0,
      }).displayName,
    ).toBe('小明');
  });

  it('sets askMerge independently from each owner’s unlinked objects', async () => {
    const tx = {
      counterpartyLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      friendship: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      counterparty: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'cp-a', askMerge: true })
          .mockResolvedValueOnce({ id: 'cp-b', askMerge: false }),
      },
    };
    await expect(
      establishLink(tx as never, { inviterId: 'alice', accepterId: 'bob' }),
    ).resolves.toEqual({
      counterpartyId: 'cp-b',
      askMerge: false,
    });
    expect(tx.counterparty.create).toHaveBeenNthCalledWith(1, {
      data: { ownerId: 'alice', name: null, askMerge: true },
    });
    expect(tx.counterparty.create).toHaveBeenNthCalledWith(2, {
      data: { ownerId: 'bob', name: null, askMerge: false },
    });
  });

  it('restores an available numbered account name when unlinking', async () => {
    const tx = {
      counterpartyLink: { findUnique: jest.fn().mockResolvedValue(link), delete: jest.fn() },
      $queryRaw: jest.fn(),
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
        ]),
      },
      counterparty: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: null }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'old-bob' })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        update: jest.fn(),
      },
      debtEntry: { updateMany: jest.fn() },
      friendship: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      debtProposal: { updateMany: jest.fn() },
      friendRequest: { updateMany: jest.fn() },
    };
    await unlinkUsers(tx as never, 'alice', 'bob', new Date());
    expect(tx.counterparty.update).toHaveBeenCalledWith({
      where: { id: 'cp-alice' },
      data: { name: 'Bob 2' },
    });
    expect(tx.counterparty.update).toHaveBeenCalledWith({
      where: { id: 'cp-bob' },
      data: { name: 'Alice' },
    });
  });

  it('trims account names before saving them, and falls back when nothing is left', async () => {
    // 帳號名稱沒有去空白的限制；照抄會違反對象名字的 CHECK，讓解除連動整筆失敗。
    const tx = {
      counterpartyLink: { findUnique: jest.fn().mockResolvedValue(link), delete: jest.fn() },
      $queryRaw: jest.fn(),
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'alice', name: '   ' },
          { id: 'bob', name: '  Bob  ' },
        ]),
      },
      counterparty: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: null }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      debtEntry: { updateMany: jest.fn() },
      friendship: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      debtProposal: { updateMany: jest.fn() },
      friendRequest: { updateMany: jest.fn() },
    };
    await unlinkUsers(tx as never, 'alice', 'bob', new Date());
    expect(tx.counterparty.update).toHaveBeenCalledWith({
      where: { id: 'cp-alice' },
      data: { name: 'Bob' },
    });
    expect(tx.counterparty.update).toHaveBeenCalledWith({
      where: { id: 'cp-bob' },
      data: { name: '對方' },
    });
  });

  describe('linkInfoFor (decision 60)', () => {
    function client(theirSum: number | null) {
      return {
        counterpartyLink: {
          findMany: jest.fn().mockResolvedValue([
            {
              ...link,
              userLow: { id: 'alice', name: 'Alice' },
              userHigh: { id: 'bob', name: 'Bob' },
            },
          ]),
        },
        debtEntry: {
          groupBy: jest
            .fn()
            .mockResolvedValue(
              theirSum === null ? [] : [{ counterpartyId: 'cp-bob', _sum: { delta: theirSum } }],
            ),
        },
      };
    }

    it('negates the other side’s balance and only reports their name', async () => {
      const info = await linkInfoFor(client(-100) as never, ['cp-alice']);
      expect(info.get('cp-alice')).toEqual({ userId: 'bob', userName: 'Bob', theirBalance: 100 });
    });

    it('reports zero, not -0, when the other side has no entries', async () => {
      const info = await linkInfoFor(client(null) as never, ['cp-alice']);
      expect(Object.is(info.get('cp-alice')!.theirBalance, 0)).toBe(true);
    });

    it('skips the queries entirely for an empty list', async () => {
      const empty = client(0);
      expect((await linkInfoFor(empty as never, [])).size).toBe(0);
      expect(empty.counterpartyLink.findMany).not.toHaveBeenCalled();
    });
  });
});
