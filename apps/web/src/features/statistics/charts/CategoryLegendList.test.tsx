import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CategoryLegendList } from './CategoryLegendList';

/** 驗證分類清單不截斷項目、精確格式化百分比，且可點項目支援鍵盤。 */
describe('CategoryLegendList', () => {
  it('shows all items, full money values, and the zero-basis-point label', () => {
    const items = Array.from({ length: 17 }, (_, index) => ({
      kind: 'CATEGORY' as const,
      category: {
        id: `category-${index}`,
        name:
          index === 0
            ? '這是一個很長的分類名稱，必須完整換行顯示而不能使用省略號'
            : `分類 ${index + 1}`,
        icon: null,
      },
      amount: index === 0 ? Number.MAX_SAFE_INTEGER : 100 + index,
      percentageBps: index === 0 ? 0 : 100,
    }));

    render(<CategoryLegendList direction="expense" items={items} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(17);
    expect(
      screen.getByText('這是一個很長的分類名稱，必須完整換行顯示而不能使用省略號'),
    ).toBeInTheDocument();
    expect(screen.getByText('$90,071,992,547,409.91')).toBeInTheDocument();
    expect(screen.getByText('<0.01%')).toBeInTheDocument();
    expect(screen.getAllByText('1%')).toHaveLength(16);
    expect(document.body.textContent).not.toContain('…');
  });

  it('activates category selection with the keyboard while leaving fixed groups unselectable', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const group = {
      kind: 'CATEGORY' as const,
      category: { id: 'food', name: '餐飲', icon: null },
      amount: 1200,
      percentageBps: 10000,
    };
    const fixedGroup = {
      kind: 'UNCATEGORIZED' as const,
      category: null,
      amount: 50,
      percentageBps: 0,
    };

    render(
      <CategoryLegendList direction="income" items={[group, fixedGroup]} onSelect={onSelect} />,
    );

    const button = screen.getByRole('button', { name: '餐飲，$12，100%' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(group);
    expect(screen.queryByRole('button', { name: /未分類/ })).not.toBeInTheDocument();
  });
});
