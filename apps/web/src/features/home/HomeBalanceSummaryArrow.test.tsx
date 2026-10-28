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
    expect(summary).toHaveTextContent('小明');
    expect(summary).toHaveTextContent('兩清');
    expect(summary).not.toHaveTextContent('→');
    expect(summary).not.toHaveTextContent('←');
  });

  it('preserves cents and the full name in the spoken summary and tooltip', () => {
    const name = '名字很長的往來對象';
    render(<HomeBalanceSummaryArrow name={name} amount={166667} />);
    expect(screen.getByLabelText(`${name}欠你 $1,666.67`)).toHaveTextContent('$1,666.67');
    expect(screen.getByTitle(name)).toHaveTextContent(name);
  });

  it.each(['', '   '])('shows a fallback avatar and name when the name is %j', (name) => {
    render(<HomeBalanceSummaryArrow name={name} amount={12500} />);

    const summary = screen.getByLabelText('未命名對象欠你 $125');
    expect(summary.children[0]?.children[0]?.textContent).toBe('?');
    expect(screen.getByTitle('—')).toHaveTextContent('—');
  });

  it.each([
    { name: '小明', initial: '小' },
    { name: '😀小明', initial: '😀' },
  ])('keeps the first visible character for $name', ({ name, initial }) => {
    render(<HomeBalanceSummaryArrow name={name} amount={12500} />);

    const summary = screen.getByLabelText(`${name}欠你 $125`);
    expect(summary.children[0]?.children[0]?.textContent).toBe(initial);
    expect(summary.children[0]?.children[1]?.textContent).toBe(name);
    expect(screen.getByTitle(name)).toHaveTextContent(name);
  });
});
