import { sideAtPoint } from './drop-side';
import { describe, expect, it } from 'vitest';

/**
 * 這組純函式測試驗證四方向判斷、卡片中心邊界與卡片外座標，供拖動轉接層重用。
 */
describe('sideAtPoint', () => {
  const rectangle = { left: 10, top: 20, width: 100, height: 80 };

  it.each([
    { x: 12, y: 60, side: 'left' },
    { x: 108, y: 60, side: 'right' },
    { x: 60, y: 22, side: 'top' },
    { x: 60, y: 98, side: 'bottom' },
  ] as const)('selects the $side side at the requested point', ({ x, y, side }) => {
    expect(sideAtPoint(rectangle, x, y)).toBe(side);
  });

  it('uses the lower half for an exact center boundary and rejects points outside the card', () => {
    expect(sideAtPoint(rectangle, 60, 60)).toBe('bottom');
    expect(sideAtPoint(rectangle, 9.99, 60)).toBeNull();
    expect(sideAtPoint(rectangle, 60, 100.01)).toBeNull();
    expect(sideAtPoint({ ...rectangle, width: 0 }, 10, 20)).toBeNull();
  });
});
