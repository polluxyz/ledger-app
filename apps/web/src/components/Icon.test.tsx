import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICON_NAMES } from './icon-paths';

/**
 * 圖示元件。
 *
 * 重點不是長相，而是「圖示永遠是裝飾」：每一個都要對螢幕閱讀器隱藏。
 * 圖示若被讀出來，按鈕的無障礙名稱就會多出一段雜訊，e2e 用名稱定位也會失準。
 */
describe('Icon', () => {
  it.each(ICON_NAMES)('renders "%s" as a decorative svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    // 至少畫了一筆，名稱對不到的話 PATHS[name] 會是 undefined、svg 是空的。
    expect(svg!.childElementCount).toBeGreaterThan(0);
  });

  it('uses the requested size and inherits the text color', () => {
    const { container } = render(<Icon name="edit" size={20} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
  });
});
