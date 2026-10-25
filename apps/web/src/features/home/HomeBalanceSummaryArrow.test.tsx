import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeBalanceSummaryArrow } from './HomeBalanceSummaryArrow';

/** 摘要箭頭只顯示一次對方姓名，方向依 API 金額決定並保留「我」端。 */
describe('HomeBalanceSummaryArrow', () => {
  it.each([
    { amount: 12500, label: '小明欠你 $125', direction: '→', textOrder: ['小明', '我'] },
    { amount: -12500, label: '你欠小明 $125', direction: '→', textOrder: ['我', '小明'] },
  ])(
    'shows the $amount direction with one name and the other end',
    ({ amount, label, direction, textOrder }) => {
      render(<HomeBalanceSummaryArrow name="小明" amount={amount} />);

      const summary = screen.getByLabelText(label);
      expect(summary.textContent?.match(/小明/g)).toHaveLength(1);
      expect(summary).toHaveTextContent('我');
      expect(summary).toHaveTextContent(direction);
      expect(summary.textContent?.indexOf(textOrder[0]!)).toBeLessThan(
        summary.textContent?.indexOf(textOrder[1]!) ?? -1,
      );
    },
  );

  it('shows 兩清 and keeps both names without drawing a direction for zero', () => {
    render(<HomeBalanceSummaryArrow name="小明" amount={0} />);

    const summary = screen.getByLabelText('小明與我兩清');
    expect(summary.textContent).toBe('小明兩清我');
    expect(summary).not.toHaveTextContent('→');
    expect(summary).not.toHaveTextContent('←');
  });
});
