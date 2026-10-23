import {
  classifyStatisticsGroup,
  statisticsGroupKey,
  statisticsGroupKindSql,
} from './statistics-groups';
import type { StatisticsGroupSource } from './statistics-groups';

const ownDebt = (kind: string, ownerId = 'me') => ({ kind, counterparty: { ownerId } });
const base: StatisticsGroupSource = { categoryId: null, differenceOf: null, debtEntry: null };

/** 固定分組以關聯擁有人做正反向對照；分類優先，不從金流或名稱推測。 */
describe('Statistics group classification', () => {
  it('prioritizes a category over both settlement difference and forgiveness', () => {
    expect(
      classifyStatisticsGroup(
        {
          categoryId: 'category',
          differenceOf: { debtEntry: ownDebt('COLLECT') },
          debtEntry: ownDebt('FORGIVE'),
        },
        'me',
      ),
    ).toBe('CATEGORY');
  });

  it.each(['COLLECT', 'REPAY'])('follows differenceOf to %s debt ownership', (kind) => {
    expect(
      classifyStatisticsGroup({ ...base, differenceOf: { debtEntry: ownDebt(kind) } }, 'me'),
    ).toBe('DIFFERENCE');
    expect(
      classifyStatisticsGroup(
        { ...base, differenceOf: { debtEntry: ownDebt(kind, 'other') } },
        'me',
      ),
    ).toBe('UNCATEGORIZED');
  });

  it.each([
    ['FORGIVE', 'BAD_DEBT'],
    ['FORGIVEN', 'DEBT_FORGIVEN'],
  ] as const)('classifies own %s and conceals another owner', (kind, expected) => {
    const transaction = { ...base, debtEntry: ownDebt(kind) };
    expect(classifyStatisticsGroup(transaction, 'me')).toBe(expected);
    expect(classifyStatisticsGroup(transaction, 'other')).toBe('UNCATEGORIZED');
    expect(classifyStatisticsGroup(transaction, 'me')).toBe(expected);
  });

  it('does not infer missing relations or ordinary debt entries', () => {
    expect(classifyStatisticsGroup(base, 'me')).toBe('UNCATEGORIZED');
    expect(classifyStatisticsGroup({ ...base, differenceOf: { debtEntry: null } }, 'me')).toBe(
      'UNCATEGORIZED',
    );
    expect(classifyStatisticsGroup({ ...base, debtEntry: ownDebt('PAID_FOR_ME') }, 'me')).toBe(
      'UNCATEGORIZED',
    );
  });

  it('builds keys without private data and parameterizes every owner comparison', () => {
    expect(statisticsGroupKey('CATEGORY', 'id')).toBe('CATEGORY:id');
    expect(statisticsGroupKey('BAD_DEBT', null)).toBe('BAD_DEBT:');
    const sql = statisticsGroupKindSql("viewer' OR true --");
    expect(sql.text).not.toContain("viewer' OR true --");
    expect(sql.values).toEqual(Array(3).fill("viewer' OR true --"));
  });
});
