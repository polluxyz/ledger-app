import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContent } from './PageContent';

/**
 * 內容寬度容器（spec 2i §4.8）。jsdom 不排版，量不到寬度，所以只驗「內容包在
 * 置中容器裡」；真正的置中與標題對齊由 e2e 的 `layout.spec.ts`（SC-36）在瀏覽器裡量。
 */
describe('PageContent', () => {
  it('wraps the page in the shared centred container', () => {
    render(
      <PageContent>
        <p>內容</p>
      </PageContent>,
    );

    expect(screen.getByText('內容').parentElement!.className).toMatch(/content/);
  });
});
