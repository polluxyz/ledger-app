import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

/**
 * 共用頁首。
 *
 * 最重要的是標題的層級：它必須是 `h2`。站名是全站唯一的 `h1`，e2e 又用
 * 「名稱＋角色」找頁面標題，層級或文字一變就會同時打破兩邊。
 */
describe('PageHeader', () => {
  it('renders the title as a level-2 heading', () => {
    render(<PageHeader title="帳戶" />);

    expect(screen.getByRole('heading', { level: 2, name: '帳戶' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows the context, description, and actions when given', () => {
    render(
      <PageHeader
        title="總覽"
        context="日常開銷・私人帳本"
        description="4 個帳戶"
        actions={<button type="button">新增帳戶</button>}
      />,
    );

    expect(screen.getByText('日常開銷・私人帳本')).toBeInTheDocument();
    expect(screen.getByText('4 個帳戶')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增帳戶' })).toBeInTheDocument();
  });

  it('renders nothing extra when only the title is given', () => {
    const { container } = render(<PageHeader title="分類" />);

    // 只有標題時，不該留下空的 <p> 或動作容器撐出多餘的高度。
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
