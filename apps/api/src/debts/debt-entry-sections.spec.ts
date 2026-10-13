import { filterDebtEntriesBySection, findDebtEntryHistoryBoundary } from './debt-entry-sections';

/** 驗證最近一次餘額歸零為已還清分界，並以新到舊的輸入順序切出兩段。 */
describe('debt-entry-sections', () => {
  it('沒有歸零紀錄時全部屬於未還清', () => {
    const entries = [
      { id: 'new', balanceAfter: 120 },
      { id: 'old', balanceAfter: 40 },
    ];

    expect(findDebtEntryHistoryBoundary(entries)).toBeNull();
    expect(filterDebtEntriesBySection(entries, 'outstanding')).toEqual(entries);
    expect(filterDebtEntriesBySection(entries, 'history')).toEqual([]);
  });

  it('最新一筆剛好歸零時整段都是歷史', () => {
    const entries = [
      { id: 'latest', balanceAfter: 0 },
      { id: 'older', balanceAfter: 100 },
    ];

    expect(findDebtEntryHistoryBoundary(entries)).toBe(0);
    expect(filterDebtEntriesBySection(entries, 'history')).toEqual(entries);
    expect(filterDebtEntriesBySection(entries, 'outstanding')).toEqual([]);
  });

  it('曾歸零兩次時以最近一次作為分界', () => {
    const entries = [
      { id: 'after-latest-zero', balanceAfter: 200 },
      { id: 'latest-zero', balanceAfter: 0 },
      { id: 'between-zeros', balanceAfter: 50 },
      { id: 'older-zero', balanceAfter: 0 },
      { id: 'oldest', balanceAfter: 100 },
    ];

    expect(findDebtEntryHistoryBoundary(entries)).toBe(1);
    expect(filterDebtEntriesBySection(entries, 'outstanding').map(({ id }) => id)).toEqual([
      'after-latest-zero',
    ]);
    expect(filterDebtEntriesBySection(entries, 'history').map(({ id }) => id)).toEqual([
      'latest-zero',
      'between-zeros',
      'older-zero',
      'oldest',
    ]);
  });

  it('空清單沒有分界，兩個區段都為空', () => {
    expect(findDebtEntryHistoryBoundary([])).toBeNull();
    expect(filterDebtEntriesBySection([], 'outstanding')).toEqual([]);
    expect(filterDebtEntriesBySection([], 'history')).toEqual([]);
  });
});
