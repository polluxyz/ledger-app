import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DebtArrow } from './DebtArrow';

describe('DebtArrow', () => {
  it('從欠款人指向被欠的人，並保留原句給螢幕閱讀器', () => {
    render(<DebtArrow from="小明" to="我" amount={12000} srText="小明欠你 $120" />);

    expect(screen.getByText('小明欠你 $120')).toBeInTheDocument();
    expect(screen.getByText('$120', { selector: '[aria-hidden="true"] *' })).toBeInTheDocument();
    expect(screen.getByText('我', { selector: '[aria-hidden="true"] *' })).toBeInTheDocument();
  });
});
