import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContent } from './PageContent';

/**
 * 內容寬度容器（spec 2i §4.8）。jsdom 不排版，量不到寬度，所以只驗「寬／窄對到
 * 不同的 class」；真正的置中與寬度由 e2e 的 `layout.spec.ts`（SC-36）在瀏覽器裡量。
 */
describe('PageContent', () => {
  it('uses a different class for wide and narrow pages', () => {
    const { rerender } = render(
      <PageContent width="wide">
        <p>內容</p>
      </PageContent>,
    );
    const wide = screen.getByText('內容').parentElement!.className;

    rerender(
      <PageContent width="narrow">
        <p>內容</p>
      </PageContent>,
    );
    const narrow = screen.getByText('內容').parentElement!.className;

    expect(wide).toMatch(/wide/);
    expect(narrow).toMatch(/narrow/);
    expect(wide).not.toBe(narrow);
  });
});
