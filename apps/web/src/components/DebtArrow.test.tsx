import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DebtArrow } from './DebtArrow';

/*
 * 驗證箭頭的可見部分（頭貼、名字、上方的字、下方的金額）與給螢幕閱讀器的原句。
 * 可見部分都在 aria-hidden 底下，所以用 selector 限定範圍。
 */
describe('DebtArrow', () => {
  const visual = '[aria-hidden="true"] *';

  it('從欠款人指向被欠的人，上方預設「欠」，下方是金額', () => {
    render(<DebtArrow from="小明" to="我" amount={12000} srText="小明欠你 $120" />);

    expect(screen.getByText('小明欠你 $120')).toBeInTheDocument();
    expect(screen.getByText('欠', { selector: visual })).toBeInTheDocument();
    expect(screen.getByText('$120', { selector: visual })).toBeInTheDocument();
    expect(screen.getByText('小明', { selector: visual })).toBeInTheDocument();
    // 頭貼先用名字第一個字代替。
    expect(screen.getByText('小', { selector: visual })).toBeInTheDocument();
  });

  it('可以換掉上方的字', () => {
    render(<DebtArrow from="我" to="小明" amount={500} label="需要支付" srText="你欠小明 $5" />);

    expect(screen.getByText('需要支付', { selector: visual })).toBeInTheDocument();
    expect(screen.queryByText('欠', { selector: visual })).not.toBeInTheDocument();
  });

  it('compact 只有名字與方向，不帶頭貼、字與金額', () => {
    render(<DebtArrow from="小華" to="我" amount={205000} compact srText="小華付給我" />);

    expect(screen.getByText('小華付給我')).toBeInTheDocument();
    expect(screen.getByText('小華', { selector: visual })).toBeInTheDocument();
    expect(screen.queryByText('小', { selector: visual })).not.toBeInTheDocument();
    expect(screen.queryByText('欠', { selector: visual })).not.toBeInTheDocument();
    expect(screen.queryByText('$2,050')).not.toBeInTheDocument();
  });
});
