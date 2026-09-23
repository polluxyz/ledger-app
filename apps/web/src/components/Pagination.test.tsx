import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

/**
 * Pagination 的呈現契約：只有一頁時整個不渲染、邊界頁的按鈕要停用、
 * 按下要回報相鄰頁碼。它是 HomePage 換頁的唯一入口，回傳錯頁會直接
 * 讓列表跳到不存在的頁。
 */
describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} limit={20} total={20} onChange={() => {}} />);

    // 只有一頁時翻頁鈕兩顆都是停用的，放著只會讓人以為壞了。
    expect(container).toBeEmptyDOMElement();
  });

  it('disables the previous button on the first page and the next on the last', () => {
    const { rerender } = render(<Pagination page={1} limit={20} total={60} onChange={() => {}} />);

    expect(screen.getByRole('button', { name: '上一頁' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一頁' })).toBeEnabled();

    rerender(<Pagination page={3} limit={20} total={60} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '上一頁' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一頁' })).toBeDisabled();
  });

  it('says which page out of how many', () => {
    render(<Pagination page={2} limit={20} total={60} onChange={() => {}} />);

    expect(screen.getByText('第 2 / 3 頁')).toBeInTheDocument();
  });

  it('reports the neighbouring page when a button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Pagination page={2} limit={20} total={60} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '上一頁' }));
    expect(onChange).toHaveBeenLastCalledWith(1);

    await user.click(screen.getByRole('button', { name: '下一頁' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});
