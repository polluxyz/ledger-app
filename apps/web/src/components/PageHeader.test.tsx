import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

/**
 * 共用頁首。
 *
 * 最重要的是標題的層級：它必須是 `h2`。站名是全站唯一的 `h1`，e2e 又用
 * 「名稱＋角色」找頁面標題，層級或文字一變就會同時打破兩邊。
 *
 * 2i 第二輪修訂之後這個元件只剩標題與說明：切換器、返回連結與頁面層級的按鈕
 * 都搬進橫條了（SC-38），所以這裡也釘住「標題是頁首裡的第一個東西」。
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
    // SC-38.5：標題上方不再有任何一行字，每一頁的標題高度才會一致。
    const { container } = render(<PageHeader title="總覽" description="說明" />);

    const header = container.querySelector('header');
    expect(header?.firstElementChild?.tagName).toBe('H2');
  });

  it('renders nothing extra when only the title is given', () => {
    const { container } = render(<PageHeader title="分類" />);

    // 只有標題時，不該留下空的 <p> 撐出多餘的高度。
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
