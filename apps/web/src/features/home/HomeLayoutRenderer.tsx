import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { HomeCardId, HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import { HOME_CARD_REGISTRY, type HomeCardRenderProps } from './card-registry';
import { HOME_LAYOUT_GAP_PX, minWidthOf, wrapSplit, type WrappedSplitLine } from './layout-math';
import { canDrop, moveCard, type HomeLayoutDropSide, type HomeLayoutCardSize } from './layout-ops';
import { HomeBandResizeHandle } from './HomeBandResizeHandle';
import { HomeLayoutDndProvider, useHomeCardDrag, type DragPoint } from './dnd-adapter';
import { ResizableSplitView } from './resizable-panels-adapter';
import { planHomeLayoutHeight, type PlannedHomeLayoutNode } from './home-layout-size';
import { sideAtPoint } from './drop-side';
import { useHomeViewportIsNarrow } from './use-home-viewport';
import styles from './HomeLayoutRenderer.module.css';

export type HomeCardContents = Partial<Record<HomeCardId, HomeCardRenderProps>>;

interface DropTarget {
  cardId: HomeCardId;
  side: HomeLayoutDropSide;
}

interface HomeLayoutRendererProps {
  cards: HomeCardContents;
  pendingCard?: ReactNode;
  /** 有帳本時桌機依分割樹排版；沒有帳本時改用不經分割樹的固定群組。 */
  layout?: HomeLayoutV1;
  fixedGroups?: readonly (readonly HomeCardId[])[];
  /** PR3 編輯畫布停用閱讀模式換行，保留版面節點的完整最小寬度。 */
  wrapMode?: 'responsive' | 'none';
  editing?: boolean;
  editorDisabled?: boolean;
  narrowViewport?: boolean;
  onLayoutChange?: (layout: HomeLayoutV1) => void;
}

/** 閱讀模式沿用 PR1 renderer；編輯能力只在桌機且有可寫草稿時啟用。 */
export function HomeLayoutRenderer({
  cards,
  pendingCard,
  layout,
  fixedGroups,
  wrapMode = 'responsive',
  editing = false,
  editorDisabled = false,
  narrowViewport,
  onLayoutChange,
}: HomeLayoutRendererProps) {
  const measuredNarrow = useHomeViewportIsNarrow();
  const isNarrow = narrowViewport ?? measuredNarrow;
  const editorEnabled = editing && !isNarrow && Boolean(layout && onLayoutChange);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const pendingFocusCardRef = useRef<HomeCardId | null>(null);
  const activeLayout = layout ?? null;
  const { ref: layoutSurfaceRef, widthPx: layoutWidthPx } = useObservedWidth();
  const [naturalCardSizes, setNaturalCardSizes] = useState<
    Partial<Record<HomeCardId, { widthPx: number; heightPx: number }>>
  >({});
  const naturalCardSizesRef = useRef(naturalCardSizes);
  const naturalCardHeightsPx = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(naturalCardSizes).map(([cardId, size]) => [cardId, size.heightPx]),
      ) as Partial<Record<HomeCardId, number>>,
    [naturalCardSizes],
  );
  const heightPlans = useMemo(
    () =>
      activeLayout?.bands.map((band) =>
        planHomeLayoutHeight(
          band.root,
          layoutWidthPx,
          naturalCardHeightsPx,
          band.extraHeightPx,
          editorEnabled ? 'none' : wrapMode,
        ),
      ) ?? [],
    [activeLayout, editorEnabled, layoutWidthPx, naturalCardHeightsPx, wrapMode],
  );

  useLayoutEffect(() => {
    naturalCardSizesRef.current = naturalCardSizes;
  }, [naturalCardSizes]);

  useLayoutEffect(() => {
    const surface = layoutSurfaceRef.current;
    if (!surface || !activeLayout || isNarrow) return;

    let animationFrame = 0;
    const measureCards = () => {
      animationFrame = 0;
      const measured: Partial<Record<HomeCardId, { widthPx: number; heightPx: number }>> = {};
      surface.querySelectorAll<HTMLElement>('[data-home-card-id]').forEach((card) => {
        const cardId = card.dataset.homeCardId;
        if (!isHomeCardId(cardId)) return;
        const rectangle = card.getBoundingClientRect();
        if (rectangle.width <= 0) return;
        const heightPx = measureNaturalCardHeight(card, rectangle.width);
        if (heightPx > 0) measured[cardId] = { widthPx: rectangle.width, heightPx };
      });

      setNaturalCardSizes((current) => {
        const changed = Object.entries(measured).some(([cardId, size]) => {
          const previous = current[cardId as HomeCardId];
          return (
            !previous ||
            Math.abs(previous.widthPx - size.widthPx) >= 0.5 ||
            Math.abs(previous.heightPx - size.heightPx) >= 0.5
          );
        });
        if (!changed) return current;
        return { ...current, ...measured };
      });
    };
    const scheduleMeasurement = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(measureCards);
    };

    measureCards();
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            if (
              entries.some((entry) => {
                const card = entry.target as HTMLElement;
                const cardId = card.dataset.homeCardId;
                if (!isHomeCardId(cardId)) return false;
                const previous = naturalCardSizesRef.current[cardId];
                return (
                  !previous ||
                  Math.abs(previous.widthPx - card.getBoundingClientRect().width) >= 0.5
                );
              })
            ) {
              scheduleMeasurement();
            }
          });
    const cardsInSurface = surface.querySelectorAll<HTMLElement>('[data-home-card-id]');
    cardsInSurface.forEach((card) => resizeObserver?.observe(card));
    const mutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleMeasurement);
    cardsInSurface.forEach((card) =>
      mutationObserver?.observe(card, {
        attributes: true,
        attributeFilter: ['class', 'aria-expanded'],
        characterData: true,
        childList: true,
        subtree: true,
      }),
    );

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [activeLayout, cards, editorEnabled, isNarrow, layoutSurfaceRef, wrapMode]);

  useLayoutEffect(() => {
    const cardId = pendingFocusCardRef.current;
    if (!cardId) return;
    pendingFocusCardRef.current = null;
    focusCardHandle(cardId);
  }, [activeLayout]);

  function findDropTarget(cardId: HomeCardId, point: DragPoint | null): DropTarget | null {
    if (
      !editorEnabled ||
      editorDisabled ||
      !activeLayout ||
      !point ||
      typeof document.elementFromPoint !== 'function'
    )
      return null;
    const targetElement = document
      .elementFromPoint(point.clientX, point.clientY)
      ?.closest<HTMLElement>('[data-home-card-id]');
    const targetId = targetElement?.dataset.homeCardId;
    if (!targetElement || !isHomeCardId(targetId) || targetId === cardId) return null;

    // 拖動中與放開時都重新量 DOM 矩形。拖動期間卡片高度改變時，落點不會使用起始快取。
    const rectangle = targetElement.getBoundingClientRect();
    const side = sideAtPoint(rectangle, point.clientX, point.clientY);
    if (
      !side ||
      !canDrop(activeLayout, cardId, targetId, side, {
        widthPx: rectangle.width,
        heightPx: rectangle.height,
      })
    ) {
      return null;
    }
    return { cardId: targetId, side };
  }

  function applyMove(cardId: HomeCardId, target: DropTarget, announce: boolean) {
    if (!editorEnabled || editorDisabled || !activeLayout || !onLayoutChange) return false;
    const size = sizeOfCard(target.cardId);
    if (!size || !canDrop(activeLayout, cardId, target.cardId, target.side, size)) return false;
    const nextLayout = moveCard(activeLayout, cardId, target.cardId, target.side);
    if (nextLayout === activeLayout) return false;
    if (announce) pendingFocusCardRef.current = cardId;
    onLayoutChange(nextLayout);
    setDropTarget(null);
    if (announce) {
      setLiveMessage(
        `${HOME_CARD_REGISTRY[cardId].title} 已移到 ${HOME_CARD_REGISTRY[target.cardId].title} ${sideLabel(target.side)}`,
      );
    }
    return true;
  }

  function handleDragEnd(cardId: HomeCardId, point: DragPoint | null) {
    const target = findDropTarget(cardId, point);
    if (target) applyMove(cardId, target, false);
    setDropTarget(null);
  }

  function renderContent() {
    if (fixedGroups) {
      const groups = isNarrow
        ? fixedGroups.flatMap((group) => group.map((id) => [id]))
        : fixedGroups;
      return (
        <div className={styles.fixedLayout} data-home-layout="fixed">
          {groups.map((group, index) => (
            <Fragment key={`${group.join('-')}-${index}`}>
              <FixedGroup cardIds={group} cards={cards} />
              {index === 0 && pendingCard && (
                <div className={styles.pendingSlot}>{pendingCard}</div>
              )}
            </Fragment>
          ))}
        </div>
      );
    }

    if (!layout) return null;
    if (isNarrow && wrapMode === 'responsive') {
      return (
        <div className={styles.fixedLayout} data-home-layout="narrow">
          {(['expense', 'income', 'net'] as const).map((cardId) => (
            <CardView key={cardId} cardId={cardId} cards={cards} />
          ))}
          {pendingCard && <div className={styles.pendingSlot}>{pendingCard}</div>}
          {(['trend', 'categories', 'activity', 'accounts', 'debts'] as const).map((cardId) => (
            <CardView key={cardId} cardId={cardId} cards={cards} />
          ))}
        </div>
      );
    }

    if (editorEnabled) {
      const canvasMinWidth = Math.max(...layout.bands.map((band) => minWidthOf(band.root)));
      return (
        <div
          className={styles.editViewport}
          data-home-layout="editing"
          data-testid="home-layout-edit-viewport"
        >
          <div className={styles.editCanvas} style={{ width: `max(100%, ${canvasMinWidth}px)` }}>
            <div className={styles.layout} data-home-wrap="none" ref={layoutSurfaceRef}>
              {layout.bands.map((band, index) => (
                <Fragment key={`band-${index}`}>
                  <EditableBand
                    band={band}
                    heightPlan={heightPlans[index] ?? null}
                    bandIndex={index}
                    layout={layout}
                    cards={cards}
                    disabled={editorDisabled}
                    dropTarget={dropTarget}
                    onLayoutChange={onLayoutChange!}
                    onMoveCard={(cardId, target, announce) => applyMove(cardId, target, announce)}
                    wrapMode="none"
                  />
                  {index === 0 && pendingCard && (
                    <div className={styles.pendingSlot}>{pendingCard}</div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={styles.layout}
        data-home-layout="tree"
        data-home-wrap={wrapMode}
        ref={layoutSurfaceRef}
      >
        {layout.bands.map((band, index) => (
          <div className={styles.band} key={`band-${index}`}>
            <div
              className={styles.bandRoot}
              style={
                heightPlans[index] ? { height: `${heightPlans[index].heightPx}px` } : undefined
              }
            >
              <LayoutNodeView
                node={band.root}
                cards={cards}
                heightPlan={heightPlans[index] ?? null}
                wrapMode={wrapMode}
                bandIndex={index}
                nodePath={[]}
              />
            </div>
            {index === 0 && pendingCard && <div className={styles.pendingSlot}>{pendingCard}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <HomeLayoutDndProvider
      enabled={editorEnabled && !editorDisabled}
      onDragStart={() => setDropTarget(null)}
      onDragMove={(cardId, point) => setDropTarget(findDropTarget(cardId, point))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDropTarget(null)}
      overlay={(cardId) =>
        cardId ? (
          <div aria-hidden="true" className={styles.dragPreview}>
            <span>⠿</span> {HOME_CARD_REGISTRY[cardId].title}
          </div>
        ) : null
      }
    >
      {() => (
        <>
          {renderContent()}
          {editorEnabled && (
            <p aria-live="polite" className={styles.srOnly}>
              {liveMessage}
            </p>
          )}
        </>
      )}
    </HomeLayoutDndProvider>
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
    <div className={styles.fixedGroup}>
      {cardIds.map((cardId) => (
        <CardView key={cardId} cardId={cardId} cards={cards} />
      ))}
    </div>
  );
}

function EditableBand({
  band,
  heightPlan,
  bandIndex,
  layout,
  cards,
  disabled,
  dropTarget,
  onLayoutChange,
  onMoveCard,
  wrapMode,
}: {
  band: HomeLayoutV1['bands'][number];
  heightPlan: PlannedHomeLayoutNode | null;
  bandIndex: number;
  layout: HomeLayoutV1;
  cards: HomeCardContents;
  disabled: boolean;
  dropTarget: DropTarget | null;
  onLayoutChange: (layout: HomeLayoutV1) => void;
  onMoveCard: (cardId: HomeCardId, target: DropTarget, announce: boolean) => boolean;
  wrapMode: 'none';
}) {
  const bandRef = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState(0);

  useLayoutEffect(() => {
    const element = bandRef.current;
    if (!element) return;
    const updateHeight = () => setHeightPx(element.getBoundingClientRect().height);
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.editBand}>
      <div
        className={styles.band}
        ref={bandRef}
        style={heightPlan ? { height: `${heightPlan.heightPx}px` } : undefined}
      >
        <LayoutNodeView
          node={band.root}
          cards={cards}
          heightPlan={heightPlan}
          wrapMode={wrapMode}
          bandIndex={bandIndex}
          nodePath={[]}
          editing
          editorDisabled={disabled}
          layout={layout}
          dropTarget={dropTarget}
          onLayoutChange={onLayoutChange}
          onMoveCard={onMoveCard}
        />
      </div>
      <HomeBandResizeHandle
        layout={layout}
        bandIndex={bandIndex}
        disabled={disabled}
        measuredHeightPx={heightPx}
        onLayoutChange={onLayoutChange}
      />
    </div>
  );
}

function LayoutNodeView({
  node,
  cards,
  heightPlan,
  wrapMode,
  bandIndex,
  nodePath,
  editing = false,
  editorDisabled = false,
  layout,
  dropTarget,
  onLayoutChange,
  onMoveCard,
}: {
  node: HomeLayoutNode;
  cards: HomeCardContents;
  heightPlan?: PlannedHomeLayoutNode | null;
  wrapMode: 'responsive' | 'none';
  bandIndex: number;
  nodePath: readonly number[];
  editing?: boolean;
  editorDisabled?: boolean;
  layout?: HomeLayoutV1;
  dropTarget?: DropTarget | null;
  onLayoutChange?: (layout: HomeLayoutV1) => void;
  onMoveCard?: (cardId: HomeCardId, target: DropTarget, announce: boolean) => boolean;
}) {
  if (node.type === 'card') {
    return (
      <CardView
        cardId={node.cardId}
        cards={cards}
        editing={editing}
        disabled={editorDisabled}
        layout={layout}
        dropTarget={dropTarget}
        onMoveCard={onMoveCard}
      />
    );
  }

  if (editing && layout && onLayoutChange) {
    const cardNames = node.children.map(cardTitleOf);
    return (
      <ResizableSplitView
        key={topologyKey(node)}
        node={node}
        path={{ bandIndex, nodePath }}
        layout={layout}
        disabled={editorDisabled}
        heightPlan={heightPlan ?? null}
        cardNames={cardNames}
        onLayoutChange={onLayoutChange}
        renderChild={(child, index) => (
          <LayoutNodeView
            node={child}
            cards={cards}
            heightPlan={childHeightPlan(heightPlan, index)}
            wrapMode="none"
            bandIndex={bandIndex}
            nodePath={[...nodePath, index]}
            editing
            editorDisabled={editorDisabled}
            layout={layout}
            dropTarget={dropTarget}
            onLayoutChange={onLayoutChange}
            onMoveCard={onMoveCard}
          />
        )}
      />
    );
  }

  return node.axis === 'x' ? (
    <HorizontalSplit
      node={node}
      cards={cards}
      heightPlan={heightPlan ?? null}
      wrapMode={wrapMode}
      bandIndex={bandIndex}
      nodePath={nodePath}
    />
  ) : (
    <VerticalSplit
      node={node}
      cards={cards}
      heightPlan={heightPlan ?? null}
      wrapMode={wrapMode}
      bandIndex={bandIndex}
      nodePath={nodePath}
    />
  );
}

function CardView({
  cardId,
  cards,
  editing = false,
  disabled = false,
  layout,
  dropTarget,
  onMoveCard,
}: {
  cardId: HomeCardId;
  cards: HomeCardContents;
  editing?: boolean;
  disabled?: boolean;
  layout?: HomeLayoutV1;
  dropTarget?: DropTarget | null;
  onMoveCard?: (cardId: HomeCardId, target: DropTarget, announce: boolean) => boolean;
}) {
  const card = cards[cardId];
  const {
    attributes,
    listeners,
    setNodeRef: cardRef,
    setActivatorNodeRef,
    isDragging,
  } = useHomeCardDrag(cardId);
  if (!card) return null;

  const title = HOME_CARD_REGISTRY[cardId].title;
  const editorControls = editing ? (
    <>
      <button
        {...attributes}
        {...listeners}
        aria-label={`拖動 ${title}`}
        className={styles.dragHandle}
        data-home-drag-handle=""
        disabled={disabled}
        ref={setActivatorNodeRef}
        type="button"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <MoveCardMenu
        cardId={cardId}
        layout={layout!}
        disabled={disabled}
        onMove={(target, side) => onMoveCard?.(cardId, { cardId: target, side }, true) ?? false}
      />
    </>
  ) : undefined;

  const target = dropTarget?.cardId === cardId ? dropTarget : null;
  const dropIndicator = target ? (
    <div
      aria-hidden="true"
      className={`${styles.dropIndicator} ${styles[`dropIndicator${capitalize(target.side)}`]}`}
    />
  ) : undefined;

  const RegisteredCard = HOME_CARD_REGISTRY[cardId].render;
  return (
    <RegisteredCard
      {...card}
      extraHeightPx={card.extraHeightPx ?? 0}
      editing={editing}
      controls={editorControls}
      cardRef={cardRef}
      isDragging={editing && isDragging}
      dropIndicator={dropIndicator}
    />
  );
}

function MoveCardMenu({
  cardId,
  layout,
  disabled,
  onMove,
}: {
  cardId: HomeCardId;
  layout: HomeLayoutV1;
  disabled: boolean;
  onMove: (targetCardId: HomeCardId, side: HomeLayoutDropSide) => boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [targetCardId, setTargetCardId] = useState<HomeCardId | ''>('');
  const targetSize = targetCardId ? sizeOfCard(targetCardId) : null;
  const sides: readonly HomeLayoutDropSide[] = ['left', 'right', 'top', 'bottom'];

  function isAllowed(side: HomeLayoutDropSide) {
    return Boolean(
      targetCardId && targetSize && canDrop(layout, cardId, targetCardId, side, targetSize),
    );
  }

  function chooseSide(side: HomeLayoutDropSide) {
    if (!targetCardId || disabled || !isAllowed(side)) return;
    if (!onMove(targetCardId, side)) return;
    setIsOpen(false);
    setTargetCardId('');
  }

  return (
    <div className={styles.moveMenu}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={styles.moveMenuTrigger}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        移到…
      </button>
      {isOpen && (
        <div className={styles.moveMenuPopover}>
          <label className={styles.moveMenuTarget}>
            <span>目標卡</span>
            <select
              aria-label="目標卡"
              disabled={disabled}
              onChange={(event) => setTargetCardId(event.currentTarget.value as HomeCardId | '')}
              value={targetCardId}
            >
              <option value="">選擇卡片</option>
              {Object.entries(HOME_CARD_REGISTRY)
                .filter(([id]) => id !== cardId)
                .map(([id, registration]) => (
                  <option key={id} value={id}>
                    {registration.title}
                  </option>
                ))}
            </select>
          </label>
          <fieldset className={styles.moveMenuDirections} disabled={disabled || !targetCardId}>
            <legend>方向</legend>
            {sides.map((side) => (
              <button
                key={side}
                disabled={!isAllowed(side)}
                onClick={() => chooseSide(side)}
                type="button"
              >
                {sideLabel(side)}
              </button>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  );
}

function HorizontalSplit({
  node,
  cards,
  heightPlan,
  wrapMode,
  bandIndex,
  nodePath,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  cards: HomeCardContents;
  heightPlan: PlannedHomeLayoutNode | null;
  wrapMode: 'responsive' | 'none';
  bandIndex: number;
  nodePath: readonly number[];
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
    <div
      className={styles.horizontalSplit}
      ref={ref}
      style={heightPlan ? { height: `${heightPlan.heightPx}px` } : undefined}
    >
      {lines.map((line, lineIndex) => (
        <div
          className={styles.horizontalLine}
          key={`line-${lineIndex}`}
          style={horizontalLineStyle(line, lineIndex, heightPlan, wrapMode, widthPx)}
        >
          {line.indices.map((childIndex) => (
            <LayoutNodeView
              key={childIndex}
              node={node.children[childIndex]!}
              cards={cards}
              heightPlan={childHeightPlan(heightPlan, childIndex)}
              wrapMode={wrapMode}
              bandIndex={bandIndex}
              nodePath={[...nodePath, childIndex]}
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
  heightPlan,
  wrapMode,
  bandIndex,
  nodePath,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  cards: HomeCardContents;
  heightPlan: PlannedHomeLayoutNode | null;
  wrapMode: 'responsive' | 'none';
  bandIndex: number;
  nodePath: readonly number[];
}) {
  const { ref } = useObservedWidth();
  return (
    <div className={styles.verticalSplit} ref={ref} style={verticalSplitStyle(heightPlan)}>
      {node.children.map((child, index) => (
        <LayoutNodeView
          key={index}
          node={child}
          cards={cards}
          heightPlan={heightPlan?.children?.[index] ?? null}
          wrapMode={wrapMode}
          bandIndex={bandIndex}
          nodePath={[...nodePath, index]}
        />
      ))}
    </div>
  );
}

function horizontalLineStyle(
  line: WrappedSplitLine,
  lineIndex: number,
  heightPlan: PlannedHomeLayoutNode | null,
  wrapMode: 'responsive' | 'none',
  widthPx: number,
): CSSProperties {
  const style: CSSProperties = {
    gridTemplateColumns: line.indices
      .map((_, columnIndex) => {
        const minimum =
          wrapMode === 'none'
            ? line.minWidthsPx[columnIndex]!
            : Math.min(line.minWidthsPx[columnIndex]!, widthPx);
        return `minmax(${minimum}px, ${line.weights[columnIndex]}fr)`;
      })
      .join(' '),
  };
  const height = heightPlan?.rows?.[lineIndex]?.heightPx;
  if (height !== undefined) style.height = `${height}px`;
  return style;
}

function verticalSplitStyle(heightPlan: PlannedHomeLayoutNode | null): CSSProperties | undefined {
  if (!heightPlan) return undefined;
  return {
    height: `${heightPlan.heightPx}px`,
    gridTemplateRows: heightPlan.children?.map((child) => `${child.heightPx}px`).join(' '),
  };
}

function childHeightPlan(
  heightPlan: PlannedHomeLayoutNode | null | undefined,
  childIndex: number,
): PlannedHomeLayoutNode | null {
  if (!heightPlan) return null;
  if (heightPlan.children) return heightPlan.children[childIndex] ?? null;
  return (
    heightPlan.rows?.flatMap((row) => row.children).find(({ index }) => index === childIndex)
      ?.plan ?? null
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

function sizeOfCard(cardId: HomeCardId): HomeLayoutCardSize | null {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-home-card-id]')).find(
    (candidate) => candidate.dataset.homeCardId === cardId,
  );
  if (!element) return null;
  const rectangle = element.getBoundingClientRect();
  return { widthPx: rectangle.width, heightPx: rectangle.height };
}

function measureNaturalCardHeight(card: HTMLElement, widthPx: number): number {
  const surface = document.createElement('div');
  surface.className = styles.naturalMeasureSurface ?? '';
  surface.setAttribute('aria-hidden', 'true');
  surface.inert = true;
  surface.style.width = `${widthPx}px`;

  const clone = card.cloneNode(true) as HTMLElement;
  clone.style.height = 'auto';
  clone.style.minHeight = '0';
  clone.style.maxHeight = 'none';
  clone.style.removeProperty('--home-card-extra-height');
  // 編輯控制是操作工具，不應改變內容本身的自然最低高度。
  clone.querySelector('[data-home-card-controls]')?.replaceChildren();
  clone.querySelector<HTMLElement>('[data-home-card-body]')?.style.setProperty('flex', '0 0 auto');
  const body = clone.querySelector<HTMLElement>('[data-home-card-body]');
  if (body) {
    body.style.height = 'auto';
    body.style.minHeight = '0';
  }
  clone.querySelectorAll('[aria-hidden="true"]').forEach((element) => {
    if (element.classList.contains(styles.dropIndicator ?? '')) element.remove();
  });

  surface.append(clone);
  document.body.append(surface);
  const heightPx = clone.getBoundingClientRect().height;
  surface.remove();
  return heightPx;
}

function cardTitleOf(node: HomeLayoutNode): string {
  return node.type === 'card'
    ? HOME_CARD_REGISTRY[node.cardId].title
    : node.axis === 'x'
      ? '左右分割'
      : '上下分割';
}

function isHomeCardId(value: string | undefined): value is HomeCardId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(HOME_CARD_REGISTRY, value);
}

function focusCardHandle(cardId: HomeCardId) {
  const focus = () =>
    document
      .querySelector<HTMLElement>(`[data-home-card-id="${cardId}"] [data-home-drag-handle]`)
      ?.focus();
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
  else focus();
}

function sideLabel(side: HomeLayoutDropSide): string {
  return { left: '左側', right: '右側', top: '上方', bottom: '下方' }[side];
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function topologyKey(node: HomeLayoutNode): string {
  return node.type === 'card'
    ? node.cardId
    : `${node.axis}[${node.children.map(topologyKey).join(',')}]`;
}

function useObservedWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);

  useLayoutEffect(() => {
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
