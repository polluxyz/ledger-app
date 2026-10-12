import { describe, expect, it } from 'vitest';
import { getAvatarLabels } from './avatar-labels';

/** 驗同一畫面區塊的單字頭貼：首字優先、衝突時逐字往後找，無法區分就保留首字。 */
describe('getAvatarLabels', () => {
  function labels(names: readonly string[]) {
    const result = getAvatarLabels(names);
    return names.map((name) => result.get(name));
  }

  it('uses the first character when labels do not conflict, preserving multi-byte characters', () => {
    expect(labels(['Alice', 'Bob', '我'])).toEqual(['A', 'B', '我']);
    expect(labels(['😀明', '😀華'])).toEqual(['明', '華']);
  });

  it('uses the first different character for names with the same first character', () => {
    expect(labels(['小明', '小華'])).toEqual(['明', '華']);
  });

  it('continues to the third character when the second still conflicts', () => {
    expect(labels(['小明明', '小明華'])).toEqual(['明', '華']);
  });

  it('treats a repeated name as one person', () => {
    expect(labels(['小明', '小華', '小明', '小美', '小明'])).toEqual([
      '明',
      '華',
      '明',
      '美',
      '明',
    ]);
  });

  it('falls back to the first character for identical names', () => {
    expect(labels(['小明', '小明'])).toEqual(['小', '小']);
  });

  it('keeps the short prefix at its first character and uses a distinguishing suffix when available', () => {
    expect(labels(['小明', '小明明'])).toEqual(['小', '明']);
  });

  it('keeps 「我」 independent while other names beginning with it follow the same rule', () => {
    expect(labels(['我', '我們', '我家'])).toEqual(['我', '們', '家']);
  });

  it('compares English initials without changing the displayed character case', () => {
    expect(labels(['t', 'T2', 't3'])).toEqual(['t', '2', '3']);
    expect(labels(['Alice', 'bob'])).toEqual(['A', 'b']);
  });
});
