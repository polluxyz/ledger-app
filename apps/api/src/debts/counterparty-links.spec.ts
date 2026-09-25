import { AppException } from '../common/exceptions/app.exception';
import {
  assertLinkChoice,
  linkInfoFor,
  otherSide,
  ownSideCounterparty,
} from './counterparty-links';

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

  describe('assertLinkChoice', () => {
    it('accepts exactly one of id or name', () => {
      expect(assertLinkChoice({ id: 'cp-1' })).toEqual({ id: 'cp-1' });
      expect(assertLinkChoice({ name: '阿A' })).toEqual({ name: '阿A' });
    });

    it.each([[undefined], [{}], [{ id: 'cp-1', name: '阿A' }]])('rejects %j with 400', (choice) => {
      let caught: unknown;
      try {
        assertLinkChoice(choice);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppException);
      expect((caught as AppException).getStatus()).toBe(400);
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
