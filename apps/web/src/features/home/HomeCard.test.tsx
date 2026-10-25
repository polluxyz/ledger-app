import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeCard } from './HomeCard';

/** 共用卡片外框提供一致標題、動作位置、內容區與 PR3 控制插槽。 */
describe('HomeCard', () => {
  it('renders its heading, action, controls slot, body, and extra height', () => {
    render(
      <HomeCard
        cardId="trend"
        title="資產趨勢"
        action={<a href="/stats">明細</a>}
        extraHeightPx={72}
      >
        <p>趨勢圖</p>
      </HomeCard>,
    );

    const card = screen.getByRole('region', { name: '資產趨勢' });
    const content = within(card);

    expect(card).toHaveAttribute('data-home-card-id', 'trend');
    expect(card).toHaveStyle({ '--home-card-extra-height': '72px' });
    expect(content.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
    expect(content.getByRole('link', { name: '明細' })).toHaveAttribute('href', '/stats');
    expect(content.getByText('趨勢圖')).toBeInTheDocument();
    expect(card.querySelector('[data-home-card-controls]')).toBeInTheDocument();
  });
});
