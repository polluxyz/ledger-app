import { allocatePercentageBps } from './percentage-bps';

/** 用可手算比例與超大整數驗證最大餘數法，並檢查輸入重排不改變同分決勝。 */
describe('Statistics percentage basis points', () => {
  it('allocates household 75/25 and leaves input untouched', () => {
    const groups = [
      { key: 'CATEGORY:dinner', amount: 90000 },
      { key: 'CATEGORY:daily', amount: 30000 },
    ];
    expect(allocatePercentageBps(groups).map((row) => row.percentageBps)).toEqual([7500, 2500]);
    expect(groups[0]).not.toHaveProperty('percentageBps');
  });

  it('breaks equal remainders by stable group key, preserving the original order', () => {
    const groups = ['CATEGORY:c', 'CATEGORY:a', 'CATEGORY:b'].map((key) => ({ key, amount: 1 }));
    expect(allocatePercentageBps(groups).map((row) => row.percentageBps)).toEqual([
      3333, 3334, 3333,
    ]);
    expect(
      allocatePercentageBps([...groups].reverse()).find((row) => row.key === 'CATEGORY:a')
        ?.percentageBps,
    ).toBe(3334);
  });

  it('retains a positive group even when allocated zero basis points', () => {
    const result = allocatePercentageBps([
      { key: 'tiny', amount: 1 },
      { key: 'large', amount: 1000000 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.percentageBps).toBe(0);
    expect(result.reduce((sum, row) => sum + row.percentageBps, 0)).toBe(10000);
  });

  it('uses exact integers even when the total and multiplication exceed safe numbers', () => {
    const result = allocatePercentageBps([
      { key: 'a', amount: Number.MAX_SAFE_INTEGER },
      { key: 'b', amount: Number.MAX_SAFE_INTEGER - 1 },
      { key: 'c', amount: 1 },
    ]);
    expect(result.map((row) => row.percentageBps)).toEqual([5000, 5000, 0]);
    expect(result.reduce((sum, row) => sum + row.percentageBps, 0)).toBe(10000);
  });

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid amount %s',
    (amount) => {
      expect(() => allocatePercentageBps([{ key: 'a', amount }])).toThrow(RangeError);
    },
  );

  it('returns an empty array when there is no denominator', () => {
    expect(allocatePercentageBps([])).toEqual([]);
  });
});
