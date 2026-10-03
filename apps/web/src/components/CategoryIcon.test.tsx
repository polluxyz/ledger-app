import { CATEGORY_ICONS, type TransactionType } from '@ledger/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryIcon } from './CategoryIcon';

/**
 * 分類圖示只用前端唯一對照表輸出 SVG；這裡逐一確認 shared 代號都能顯示，
 * 並釘住沒有圖示、未知代號與借還／轉帳固定圖示的回退行為。
 */
describe('CategoryIcon', () => {
  it.each(CATEGORY_ICONS)('renders the lucide icon for %s', (icon) => {
    const { container } = render(<CategoryIcon icon={icon} />);

    expect(container.querySelector('svg')).toHaveAttribute('data-category-icon', icon);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the generic icon for null and unknown category codes', () => {
    const { container, rerender } = render(<CategoryIcon icon={null} />);

    expect(container.querySelector('svg')).toHaveAttribute('data-category-icon', 'other');

    rerender(<CategoryIcon icon="newer-server-code" transactionType="LEND" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-category-icon', 'other');
  });

  it.each([
    ['LEND', 'lend'],
    ['REPAY', 'repay'],
    ['BORROW', 'borrow'],
    ['COLLECT', 'collect'],
    ['TRANSFER', 'transfer'],
  ] as const)('uses the fixed icon for %s transactions', (type, expected) => {
    const { container } = render(
      <CategoryIcon icon={null} transactionType={type as TransactionType} />,
    );

    expect(container.querySelector('svg')).toHaveAttribute('data-category-icon', expected);
  });
});
