import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOME_LAYOUT_V1, HOME_CARD_IDS, type HomeCardId } from '@ledger/shared';
import { HomeLayoutRenderer, type HomeCardContents } from './HomeLayoutRenderer';
import styles from './HomeLayoutRenderer.module.css';

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = window.ResizeObserver;

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setViewportWidthMatches(matches: boolean) {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalResizeObserver) {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: originalResizeObserver,
    });
  } else {
    Reflect.deleteProperty(window, 'ResizeObserver');
  }
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
});

/** Renderer 測試涵蓋窄視窗版面、編輯操作、移動選單關閉與焦點返回。 */
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

  it('does not remeasure equivalent card props but remeasures changed card content', async () => {
    setViewportWidthMatches(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 100,
      width: 500,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const cloneNode = vi.spyOn(Node.prototype, 'cloneNode');
    const { rerender } = render(
      <HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardContents()} />,
    );
    const initialMeasurementCount = cloneNode.mock.calls.length;

    expect(initialMeasurementCount).toBe(HOME_CARD_IDS.length);

    rerender(<HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardContents()} />);

    expect(cloneNode).toHaveBeenCalledTimes(initialMeasurementCount);

    const changedCards = cardContents();
    changedCards.expense = { children: <span>更新後的支出內容</span> };
    rerender(<HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={changedCards} />);

    await waitFor(() =>
      expect(cloneNode).toHaveBeenCalledTimes(initialMeasurementCount + HOME_CARD_IDS.length),
    );
  });

  it('remeasures a card when its DOM root is replaced after observers are installed', async () => {
    setViewportWidthMatches(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 100,
      width: 500,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const cloneNode = vi.spyOn(Node.prototype, 'cloneNode');
    const initialCards = cardContents();
    const { rerender } = render(
      <HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={initialCards} />,
    );
    const initialMeasurementCount = cloneNode.mock.calls.length;

    const cardsWithoutExpense = cardContents();
    delete cardsWithoutExpense.expense;
    rerender(<HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardsWithoutExpense} />);

    const restoredCards = cardContents();
    restoredCards.expense = { children: <span>重新載入後的支出內容</span> };
    rerender(<HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={restoredCards} />);

    await waitFor(
      () =>
        expect(cloneNode.mock.calls.length).toBeGreaterThanOrEqual(
          initialMeasurementCount + HOME_CARD_IDS.length,
        ),
      { timeout: 1000 },
    );
  });

  it('does not remeasure cards for drop indicator-only mutations', async () => {
    setViewportWidthMatches(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 100,
      width: 500,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const cloneNode = vi.spyOn(Node.prototype, 'cloneNode');
    const { container } = render(
      <HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cardContents()} />,
    );
    const initialMeasurementCount = cloneNode.mock.calls.length;
    const card = container.querySelector<HTMLElement>('[data-home-card-id="expense"]')!;
    const dropIndicator = document.createElement('div');
    expect(styles.dropIndicator).toBeTruthy();
    dropIndicator.className = styles.dropIndicator!;

    await act(async () => {
      card.append(dropIndicator);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(cloneNode).toHaveBeenCalledTimes(initialMeasurementCount);
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

  it('keeps reading mode free of editor controls while card links and buttons remain usable', () => {
    setViewportWidthMatches(false);
    const onClick = vi.fn();
    const cards = cardContents();
    cards.expense = {
      children: (
        <>
          <a href="/transactions">查看交易</a>
          <button onClick={onClick} type="button">
            卡片按鈕
          </button>
        </>
      ),
    };
    render(<HomeLayoutRenderer layout={DEFAULT_HOME_LAYOUT_V1} cards={cards} />);

    expect(document.querySelector('[data-home-drag-handle]')).not.toBeInTheDocument();
    expect(document.querySelector('[role="separator"]')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看交易' })).toHaveAttribute('href', '/transactions');
    fireEvent.click(screen.getByRole('button', { name: '卡片按鈕' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('locks only card content in edit mode and keeps the move menu outside inert areas', () => {
    setViewportWidthMatches(false);
    const cards = cardContents();
    const { container } = render(
      <>
        <h1>總覽</h1>
        <section data-testid="ai-draft">AI 草稿</section>
        <HomeLayoutRenderer
          layout={DEFAULT_HOME_LAYOUT_V1}
          cards={cards}
          editing
          narrowViewport={false}
          onLayoutChange={vi.fn()}
        />
      </>,
    );

    const card = container.querySelector<HTMLElement>('[data-home-card-id="expense"]')!;
    expect(card.querySelector('[class*="headerMain"]')).toHaveAttribute('inert');
    expect(card.querySelector('[class*="body"]')).toHaveAttribute('inert');
    expect(card.querySelector('[data-home-card-controls]')).not.toHaveAttribute('inert');
    expect(within(card).getByRole('button', { name: '拖動 本月支出' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '總覽' })).not.toHaveAttribute('inert');
    expect(screen.getByTestId('ai-draft')).not.toHaveAttribute('inert');
  });

  it('disables invalid move directions and returns focus with a live announcement after moving', async () => {
    setViewportWidthMatches(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return {
        left: 0,
        top: 0,
        right: 500,
        bottom: 500,
        width: 500,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    const cards = cardContents();
    function EditableLayout() {
      const [layout, setLayout] = useState(DEFAULT_HOME_LAYOUT_V1);
      return (
        <HomeLayoutRenderer
          layout={layout}
          cards={cards}
          editing
          narrowViewport={false}
          onLayoutChange={setLayout}
        />
      );
    }
    const { container } = render(<EditableLayout />);
    const expense = container.querySelector<HTMLElement>('[data-home-card-id="expense"]')!;

    fireEvent.click(within(expense).getByRole('button', { name: '移到…' }));
    fireEvent.change(screen.getByRole('combobox', { name: '目標卡' }), {
      target: { value: 'income' },
    });

    expect(screen.getByRole('button', { name: '左側' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '右側' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上方' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下方' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '上方' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-home-card-id="expense"] [data-home-drag-handle]'),
      ),
    );
    expect(screen.getByText('本月支出 已移到 本月收入 上方')).toBeInTheDocument();
  });

  it('closes the move menu on Escape and returns focus to its trigger', () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing
        narrowViewport={false}
        onLayoutChange={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole('button', { name: '移到…' })[0]!;
    fireEvent.click(trigger);
    const targetSelect = screen.getByRole('combobox', { name: '目標卡' });
    targetSelect.focus();
    fireEvent.keyDown(targetSelect, { key: 'Escape' });

    expect(screen.queryByRole('combobox', { name: '目標卡' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('focuses the target select when the move menu first opens', async () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing
        narrowViewport={false}
        onLayoutChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '移到…' })[0]!);

    const targetSelect = await screen.findByRole('combobox', { name: '目標卡' });
    await waitFor(() => expect(targetSelect).toHaveFocus());
  });

  it('closes and returns focus when Tab leaves the last move direction', async () => {
    setViewportWidthMatches(false);
    const user = userEvent.setup();
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing
        narrowViewport={false}
        onLayoutChange={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole('button', { name: '移到…' })[0]!;
    await user.click(trigger);
    await user.selectOptions(screen.getByRole('combobox', { name: '目標卡' }), 'income');
    const lastDirection = screen.getByRole('button', { name: '下方' });
    lastDirection.focus();
    await user.tab();

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: '目標卡' })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('closes and returns focus when focus leaves the target select', async () => {
    setViewportWidthMatches(false);
    const user = userEvent.setup();
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing
        narrowViewport={false}
        onLayoutChange={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole('button', { name: '移到…' })[0]!;
    await user.click(trigger);
    const targetSelect = screen.getByRole('combobox', { name: '目標卡' });
    fireEvent.blur(targetSelect, { relatedTarget: document.body });

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: '目標卡' })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('closes the move menu after clicking outside it', () => {
    setViewportWidthMatches(false);
    render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing
        narrowViewport={false}
        onLayoutChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '移到…' })[0]!);
    expect(screen.getByRole('combobox', { name: '目標卡' })).toBeInTheDocument();

    fireEvent.click(document.body);

    expect(screen.queryByRole('combobox', { name: '目標卡' })).not.toBeInTheDocument();
  });

  it('shows the one-column paused view without editor handles at 900px', () => {
    setViewportWidthMatches(true);
    const { container } = render(
      <HomeLayoutRenderer
        layout={DEFAULT_HOME_LAYOUT_V1}
        cards={cardContents()}
        editing={false}
        narrowViewport
        wrapMode="responsive"
        onLayoutChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-home-layout="narrow"]')).toBeInTheDocument();
    expect(container.querySelector('[data-home-drag-handle]')).not.toBeInTheDocument();
    expect(container.querySelector('[role="separator"]')).not.toBeInTheDocument();
  });
});
