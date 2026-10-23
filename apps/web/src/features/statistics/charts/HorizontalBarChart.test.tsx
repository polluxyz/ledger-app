import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HorizontalBarChart } from './HorizontalBarChart';

/** 驗證橫條圖完整保留資料順序、長名稱與安全整數金額。 */
describe('HorizontalBarChart', () => {
  it('renders every group and keeps long labels and large money values intact', () => {
    const items = Array.from({ length: 16 }, (_, index) => ({
      kind: 'CATEGORY' as const,
      category: {
        id: `category-${index}`,
        name:
          index === 0
            ? '這是一個非常長的分類名稱，必須換行完整呈現，不可以省略任何文字'
            : `分類 ${index + 1}`,
        icon: null,
      },
      amount: index === 0 ? Number.MAX_SAFE_INTEGER : 100 + index,
      percentageBps: index === 0 ? 1 : 0,
    }));

    render(<HorizontalBarChart direction="expense" data={{ kind: 'groups', items }} />);

    const rows = screen.getAllByRole('listitem');
    const firstRow = rows[0];
    const lastRow = rows[15];
    const firstItem = items[0];
    if (!firstRow || !lastRow || !firstItem) {
      throw new Error('Expected all 16 horizontal bar rows to render');
    }
    expect(rows).toHaveLength(16);
    expect(within(firstRow).getByText(firstItem.category.name)).toBeInTheDocument();
    expect(within(firstRow).getByText('$90,071,992,547,409.91')).toBeInTheDocument();
    expect(within(lastRow).getByText('分類 16')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('…');
  });

  it('shows an empty label and avoids invalid dimensions for empty data', () => {
    const { container } = render(
      <HorizontalBarChart direction="income" data={{ kind: 'groups', items: [] }} />,
    );

    expect(screen.getByText('沒有資料')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
