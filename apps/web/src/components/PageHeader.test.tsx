import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

/**
 * 共用頁首。
 *
 * 最重要的是標題的層級：它必須是 `h2`。站名是全站唯一的 `h1`，e2e 又用
 * 「名稱＋角色」找頁面標題，層級或文字一變就會同時打破兩邊。
 *
 * 2026-10-07 修訂之後，頁面層級的按鈕（「＋ 新增交易」這類）回到頁首，經由
 * `actions` 放在標題同一排的右邊——所以除了標題與說明，這裡也釘住「標題還是
 * 頁首裡的第一個東西」與「動作在標題後面」。
 */
describe('PageHeader', () => {
  it('renders the title as a level-2 heading', () => {
    render(<PageHeader title="帳戶" />);

    expect(screen.getByRole('heading', { level: 2, name: '帳戶' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows the description under the title', () => {
    render(<PageHeader title="帳戶" description="餘額由伺服器依交易即時計算" />);

    expect(screen.getByText('餘額由伺服器依交易即時計算')).toBeInTheDocument();
  });

  it('puts nothing above the title', () => {
    // 標題上方不再有任何一行字，每一頁的標題高度才會一致。
    const { container } = render(<PageHeader title="總覽" description="說明" />);

    const header = container.querySelector('header');
    expect(header?.firstElementChild?.tagName).toBe('H2');
  });

  it('renders nothing extra when only the title is given', () => {
    const { container } = render(<PageHeader title="分類" />);

    // 只有標題時，不該留下空的 <p> 或動作容器撐出多餘的高度。
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '分類' }).parentElement?.children).toHaveLength(1);
  });

  it('places the actions beside the title, inside the same header', () => {
    // 頁面層級的主要按鈕在標題同一排右邊（開發者 2026-10-07）。判準不看 CSS
    // 類名：同一個 <header> 裡、標題後面，就是「同一排右邊」。
    render(
      <PageHeader
        title="帳戶"
        description="說明"
        actions={<button type="button">新增帳戶</button>}
      />,
    );

    const header = screen.getByRole('heading', { name: '帳戶' }).closest('header');
    const button = screen.getByRole('button', { name: '新增帳戶' });

    expect(header).toContainElement(button);
    expect(header?.firstElementChild?.tagName).toBe('H2');
    expect(
      screen.getByRole('heading', { name: '帳戶' }).compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    // 說明仍在標題下面，不會被動作擠到同一排。
    expect(
      screen
        .getByRole('heading', { name: '帳戶' })
        .compareDocumentPosition(screen.getByText('說明')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
});
