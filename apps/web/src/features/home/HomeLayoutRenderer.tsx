import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { HomeCardId, HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import { HOME_CARD_REGISTRY, type HomeCardRenderProps } from './card-registry';
import { HOME_LAYOUT_GAP_PX, minWidthOf, wrapSplit } from './layout-math';
import styles from './HomeLayoutRenderer.module.css';

const NARROW_VIEWPORT_QUERY = '(max-width: 900px)';

export type HomeCardContents = Partial<Record<HomeCardId, HomeCardRenderProps>>;

interface HomeLayoutRendererProps {
  cards: HomeCardContents;
  pendingCard?: ReactNode;
  /** 有帳本時桌機依分割樹排版；沒有帳本時改用不經分割樹的固定群組。 */
  layout?: HomeLayoutV1;
  fixedGroups?: readonly (readonly HomeCardId[])[];
  /** PR3 編輯畫布停用閱讀模式換行，保留版面節點的完整最小寬度。 */
  wrapMode?: 'responsive' | 'none';
}

/** 以容器實際寬度顯示預設版面；小視窗與無帳本版面使用固定卡片順序。 */
export function HomeLayoutRenderer({
  cards,
  pendingCard,
  layout,
  fixedGroups,
  wrapMode = 'responsive',
}: HomeLayoutRendererProps) {
  const isNarrow = useNarrowHomeViewport();

  if (fixedGroups) {
    const groups = isNarrow ? fixedGroups.flatMap((group) => group.map((id) => [id])) : fixedGroups;
    return (
      <div className={styles.fixedLayout} data-home-layout="fixed">
        {groups.map((group, index) => (
          <Fragment key={`${group.join('-')}-${index}`}>
            <FixedGroup cardIds={group} cards={cards} />
            {index === 0 && pendingCard && <div className={styles.pendingSlot}>{pendingCard}</div>}
          </Fragment>
        ))}
      </div>
    );
  }

  if (!layout) return null;
  if (isNarrow && wrapMode === 'responsive') {
    return (
      <div className={styles.fixedLayout} data-home-layout="narrow">
        {(['expense', 'income', 'net'] as const).map((cardId) => renderCard(cardId, cards))}
        {pendingCard && <div className={styles.pendingSlot}>{pendingCard}</div>}
        {(['trend', 'categories', 'activity', 'accounts', 'debts'] as const).map((cardId) =>
          renderCard(cardId, cards),
        )}
      </div>
    );
  }

  return (
    <div className={styles.layout} data-home-layout="tree" data-home-wrap={wrapMode}>
      {layout.bands.map((band, index) => (
        <div className={styles.band} key={`band-${index}`}>
          <LayoutNodeView
            node={band.root}
            cards={cards}
            extraHeightPx={band.extraHeightPx}
            wrapMode={wrapMode}
          />
          {index === 0 && pendingCard && <div className={styles.pendingSlot}>{pendingCard}</div>}
        </div>
      ))}
    </div>
  );
}

function FixedGroup({
  cardIds,
  cards,
}: {
  cardIds: readonly HomeCardId[];
  cards: HomeCardContents;
}) {
  return (
    <div className={styles.fixedGroup}>{cardIds.map((cardId) => renderCard(cardId, cards))}</div>
  );
}

function LayoutNodeView({
  node,
  cards,
  extraHeightPx = 0,
  wrapMode,
}: {
  node: HomeLayoutNode;
  cards: HomeCardContents;
  extraHeightPx?: number;
  wrapMode: 'responsive' | 'none';
}) {
  if (node.type === 'card') return renderCard(node.cardId, cards, extraHeightPx);

  return node.axis === 'x' ? (
    <HorizontalSplit node={node} cards={cards} extraHeightPx={extraHeightPx} wrapMode={wrapMode} />
  ) : (
    <VerticalSplit node={node} cards={cards} extraHeightPx={extraHeightPx} wrapMode={wrapMode} />
  );
}

function HorizontalSplit({
  node,
  cards,
  extraHeightPx,
  wrapMode,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  cards: HomeCardContents;
  extraHeightPx: number;
  wrapMode: 'responsive' | 'none';
}) {
  const { ref, widthPx } = useObservedWidth();
  const minWidthsPx = node.children.map(minWidthOf);
  const lines =
    wrapMode === 'none'
      ? [makeSingleLine(node.children.length, minWidthsPx, node.weights)]
      : widthPx > 0
        ? wrapSplit(widthPx, minWidthsPx, node.weights, HOME_LAYOUT_GAP_PX)
        : node.children.map((_, index) => ({
            indices: [index],
            minWidthsPx: [minWidthsPx[index]!],
            weights: [node.weights[index]!],
            columnWidthsPx: [0],
          }));

  return (
    <div className={styles.horizontalSplit} ref={ref}>
      {lines.map((line, lineIndex) => (
        <div
          className={styles.horizontalLine}
          key={`line-${lineIndex}`}
          style={{
            gridTemplateColumns: line.indices
              .map((_, columnIndex) => {
                const minimum =
                  wrapMode === 'none'
                    ? line.minWidthsPx[columnIndex]!
                    : Math.min(line.minWidthsPx[columnIndex]!, widthPx);
                return `minmax(${minimum}px, ${line.weights[columnIndex]}fr)`;
              })
              .join(' '),
          }}
        >
          {line.indices.map((childIndex) => (
            <LayoutNodeView
              key={childIndex}
              node={node.children[childIndex]!}
              cards={cards}
              extraHeightPx={extraHeightPx}
              wrapMode={wrapMode}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function VerticalSplit({
  node,
  cards,
  extraHeightPx,
  wrapMode,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  cards: HomeCardContents;
  extraHeightPx: number;
  wrapMode: 'responsive' | 'none';
}) {
  const { ref } = useObservedWidth();
  return (
    <div className={styles.verticalSplit} ref={ref}>
      {node.children.map((child, index) => (
        <LayoutNodeView
          key={index}
          node={child}
          cards={cards}
          extraHeightPx={index === node.children.length - 1 ? extraHeightPx : 0}
          wrapMode={wrapMode}
        />
      ))}
    </div>
  );
}

function makeSingleLine(
  childCount: number,
  minWidthsPx: readonly number[],
  weights: readonly number[],
) {
  return {
    indices: Array.from({ length: childCount }, (_, index) => index),
    minWidthsPx: [...minWidthsPx],
    weights: [...weights],
    columnWidthsPx: Array.from({ length: childCount }, () => 0),
  };
}

function renderCard(cardId: HomeCardId, cards: HomeCardContents, extraHeightPx = 0) {
  const card = cards[cardId];
  if (!card) return null;
  return (
    <Fragment key={cardId}>
      {HOME_CARD_REGISTRY[cardId].render({
        ...card,
        extraHeightPx: Math.max(card.extraHeightPx ?? 0, extraHeightPx),
      })}
    </Fragment>
  );
}

function useNarrowHomeViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => matchesNarrowViewport());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const update = () => setIsNarrow(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);

  return isNarrow;
}

function matchesNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(NARROW_VIEWPORT_QUERY).matches
  );
}

function useObservedWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = (width: number) => {
      setWidthPx((current) => (Math.abs(current - width) < 0.5 ? current : width));
    };
    updateWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, widthPx };
}
