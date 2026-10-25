import { useEffect } from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOME_LAYOUT_V1, HOME_CARD_IDS, type HomeCardId } from '@ledger/shared';
import { HomeLayoutRenderer, type HomeCardContents } from './HomeLayoutRenderer';

const originalMatchMedia = window.matchMedia;

function setViewportWidthMatches(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    media: '(max-width: 900px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => media),
  });
}

function cardContents(cardIds: readonly HomeCardId[] = HOME_CARD_IDS): HomeCardContents {
  return Object.fromEntries(cardIds.map((cardId) => [cardId, { children: <span>{cardId}</span> }]));
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
});

/** Renderer 測試涵蓋窄視窗的固定順序、待處理卡位置與無帳本固定版面。 */
describe('HomeLayoutRenderer', () => {
  it('uses one fixed column at 900px and places the pending card after the third summary card', () => {
    setViewportWidthMatches(true);
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        pendingCard={<div data-testid="pending-card">待確認</div>}
      />,
    );

    const layout = screen.getByTestId('pending-card').parentElement?.parentElement;
    expect(layout).toHaveAttribute('data-home-layout', 'narrow');
    expect(layout).toHaveClass(/fixedLayout/);
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 900px)');
    expect(
      Array.from(layout!.querySelectorAll<HTMLElement>('[data-home-card-id]')).map((card) =>
        card.getAttribute('data-home-card-id'),
      ),
    ).toEqual([...HOME_CARD_IDS]);
    const cards = Array.from(layout!.querySelectorAll<HTMLElement>('[data-home-card-id]'));
    expect(cards[2]?.nextElementSibling).toContainElement(screen.getByTestId('pending-card'));
    expect(
      screen.getByTestId('pending-card').compareDocumentPosition(cards[3]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('places the pending card after the first root band on desktop', () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        pendingCard={<div data-testid="pending-card">待確認</div>}
      />,
    );

    const pending = screen.getByTestId('pending-card');
    const expense = document.querySelector<HTMLElement>('[data-home-card-id="expense"]')!;
    const income = document.querySelector<HTMLElement>('[data-home-card-id="income"]')!;
    const net = document.querySelector<HTMLElement>('[data-home-card-id="net"]')!;
    const trend = document.querySelector<HTMLElement>('[data-home-card-id="trend"]')!;
    const firstBand = pending.parentElement?.parentElement;

    expect(firstBand).toContainElement(expense);
    expect(firstBand).toContainElement(income);
    expect(firstBand).toContainElement(net);
    expect(firstBand).not.toContainElement(trend);
    expect(net.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(pending.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('keeps each horizontal split on one line when wrapping is disabled', () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardContents()} wrapMode="none" />,
    );

    const layout = screen.getByText('expense').closest('[data-home-layout="tree"]');
    const firstLine = screen.getByText('expense').closest('[class*="horizontalLine"]');

    expect(layout).toHaveAttribute('data-home-wrap', 'none');
    expect(screen.getByText('income').closest('[class*="horizontalLine"]')).toBe(firstLine);
    expect(screen.getByText('net').closest('[class*="horizontalLine"]')).toBe(firstLine);
  });

  it('uses fixed groups without a split tree when there is no active ledger', () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer
        fixedGroups={[['trend'], ['accounts', 'debts']]}
        cards={cardContents(['trend', 'accounts', 'debts'])}
        pendingCard={<div data-testid="pending-card">待確認</div>}
      />,
    );

    const layout = screen.getByTestId('pending-card').parentElement?.parentElement;
    expect(layout).toHaveAttribute('data-home-layout', 'fixed');
    expect(layout?.querySelector('[data-home-layout="tree"]')).not.toBeInTheDocument();
    const groups = layout?.querySelectorAll(':scope > div');
    expect(groups).toHaveLength(3);
    expect(groups![1]).toContainElement(screen.getByTestId('pending-card'));
    expect(within(groups![0] as HTMLElement).getByText('trend')).toBeInTheDocument();
    const account = layout?.querySelector('[data-home-card-id="accounts"]');
    const debts = layout?.querySelector('[data-home-card-id="debts"]');
    expect(within(groups![2] as HTMLElement).getByText('accounts')).toBeInTheDocument();
    expect(within(groups![2] as HTMLElement).getByText('debts')).toBeInTheDocument();
    expect(account?.parentElement).toBe(debts?.parentElement);
    expect(account?.parentElement).toHaveClass(/fixedGroup/);
  });

  it('updates the fixed layout when the media query changes', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    let matches = true;
    const media = {
      get matches() {
        return matches;
      },
      media: '(max-width: 900px)',
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.push(listener),
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media),
    });
    vi.stubGlobal('matchMedia', window.matchMedia);

    function WidthChange() {
      useEffect(() => {
        matches = false;
        listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
      }, []);
      return null;
    }

    render(
      <>
        <HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardContents()} />
        <WidthChange />
      </>,
    );

    expect(screen.getByText('expense').closest('[data-home-layout]')).toHaveAttribute(
      'data-home-layout',
      'tree',
    );
  });
});
