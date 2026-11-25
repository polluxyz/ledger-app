import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineArt } from './LineArt';

// 逐一檢查圖形都有繪製內容，並且不影響可及名稱或鍵盤焦點。
describe('LineArt', () => {
  it.each(['ledger', 'wallet', 'tag', 'person'] as const)('renders %s as decoration', (subject) => {
    const { container } = render(
      <button type="button">
        <LineArt subject={subject} placement="empty" />
        編輯
      </button>,
    );
    const svg = container.querySelector('svg')!;

    expect(svg.querySelector('path[d]')).toBeInTheDocument();
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('tabindex');
    expect(svg).not.toHaveAccessibleName();
    expect(svg.querySelector('title')).not.toBeInTheDocument();
    expect(container.querySelector('button')).toHaveAccessibleName('編輯');
  });
});
