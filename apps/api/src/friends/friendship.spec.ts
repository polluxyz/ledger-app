import { orderPair } from './friendship';

/**
 * `orderPair` 的排序必須與資料庫 CHECK 約束 `Friendship_ordered`（`COLLATE "C"`）一致，
 * 否則正確排序的寫入會被資料庫拒絕。用固定的 UUID 鎖住幾個容易出錯的邊界：
 * 數字與字母的先後、只差最後一位、以及參數順序不影響結果。
 */
describe('orderPair', () => {
  const digitsFirst = '0a000000-0000-4000-8000-000000000000';
  const lettersLater = 'a0000000-0000-4000-8000-000000000000';

  it('puts the smaller id in userLowId regardless of argument order', () => {
    expect(orderPair(lettersLater, digitsFirst)).toEqual({
      userLowId: digitsFirst,
      userHighId: lettersLater,
    });
    expect(orderPair(digitsFirst, lettersLater)).toEqual({
      userLowId: digitsFirst,
      userHighId: lettersLater,
    });
  });

  it('orders ids that differ only in the last character', () => {
    const a = 'ffffffff-ffff-4fff-8fff-fffffffffff0';
    const b = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    expect(orderPair(b, a)).toEqual({ userLowId: a, userHighId: b });
  });

  // 數字（0x30–0x39）排在小寫字母（0x61–0x66）之前，與 PostgreSQL 的 "C" collation 相同。
  it('sorts digits before lowercase hex letters, like COLLATE "C"', () => {
    const nine = '90000000-0000-4000-8000-000000000000';
    const a = 'a0000000-0000-4000-8000-000000000000';
    expect(orderPair(a, nine).userLowId).toBe(nine);
  });

  it('refuses to pair a user with themselves', () => {
    expect(() => orderPair(digitsFirst, digitsFirst)).toThrow();
  });
});
