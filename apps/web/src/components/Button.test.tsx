import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

/**
 * Button 的基本契約：原生屬性原樣透傳（type、disabled、onClick），樣式變體與
 * block 只影響 class。它是整個 app 按鈕的基底，透傳壞了會在很多地方同時壞。
 */
describe('Button', () => {
  it('renders its children as a button', () => {
    render(<Button>儲存</Button>);

    expect(screen.getByRole('button', { name: '儲存' })).toBeInTheDocument();
  });

  it('applies the variant and block classes', () => {
    render(
      <>
        <Button>主要</Button>
        <Button variant="secondary" block>
          次要
        </Button>
      </>,
    );

    expect(screen.getByRole('button', { name: '主要' }).className).toMatch(/primary/);
    expect(screen.getByRole('button', { name: '主要' }).className).not.toMatch(/secondary/);
    // 次要 + block：兩個 class 都要掛上。
    expect(screen.getByRole('button', { name: '次要' }).className).toMatch(/secondary/);
    expect(screen.getByRole('button', { name: '次要' }).className).toMatch(/block/);
  });

  it('passes native attributes through and reports clicks', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button type="submit" onClick={onClick}>
        送出
      </Button>,
    );

    const button = screen.getByRole('button', { name: '送出' });
    expect(button).toHaveAttribute('type', 'submit');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button when disabled is set', () => {
    render(<Button disabled>停用中</Button>);

    expect(screen.getByRole('button', { name: '停用中' })).toBeDisabled();
  });

  it('merges a custom className into the variant classes', () => {
    render(<Button className="danger">刪除</Button>);

    // ConfirmDialog 靠這個機制做危險樣式：variant 的 class 要在，
    // 外來的 class 也要併進去，任何一邊被覆蓋都會讓那個樣式失效。
    const button = screen.getByRole('button', { name: '刪除' });
    expect(button.className).toMatch(/primary/);
    expect(button.className).toMatch(/danger/);
  });
});
