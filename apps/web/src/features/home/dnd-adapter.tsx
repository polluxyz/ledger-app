import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DraggableAttributes,
} from '@dnd-kit/core';
import type { HomeCardId } from '@ledger/shared';
import styles from './HomeLayoutRenderer.module.css';

/**
 * `@dnd-kit/core` 僅在此轉接層出現；它負責指標生命週期與自動捲動，
 * 版面產品邏輯只接收卡片 id 和放開當下的指標座標。
 */

export interface DragPoint {
  clientX: number;
  clientY: number;
}

export interface DragHandleBindings {
  attributes: DraggableAttributes;
  listeners?: NonNullable<ReturnType<typeof useDraggable>['listeners']>;
  setNodeRef: (element: HTMLElement | null) => void;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  isDragging: boolean;
}

interface DragContextValue {
  enabled: boolean;
}

const HomeDragContext = createContext<DragContextValue>({ enabled: false });

export function HomeLayoutDndProvider({
  enabled,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  overlay,
  children,
}: {
  enabled: boolean;
  onDragStart: (cardId: HomeCardId) => void;
  onDragMove: (cardId: HomeCardId, point: DragPoint | null) => void;
  onDragEnd: (cardId: HomeCardId, point: DragPoint | null) => void;
  onDragCancel: () => void;
  overlay: (activeId: HomeCardId | null) => ReactNode;
  children: (activeId: HomeCardId | null) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeId, setActiveId] = useState<HomeCardId | null>(null);
  const activeIdRef = useRef<HomeCardId | null>(null);
  const cancelledRef = useRef(false);

  const cancelActiveDrag = useCallback(() => {
    if (!activeIdRef.current) return;
    activeIdRef.current = null;
    cancelledRef.current = true;
    setActiveId(null);
    onDragCancel();
  }, [onDragCancel]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointercancel', cancelActiveDrag, true);
    return () => document.removeEventListener('pointercancel', cancelActiveDrag, true);
  }, [cancelActiveDrag]);

  const handleStart = (id: string) => {
    if (!enabled) return;
    const cardId = id as HomeCardId;
    activeIdRef.current = cardId;
    cancelledRef.current = false;
    setActiveId(cardId);
    onDragStart(cardId);
  };

  const handleMove = (id: string, point: DragPoint | null) => {
    if (enabled && !cancelledRef.current) onDragMove(id as HomeCardId, point);
  };

  const handleEnd = (id: string, point: DragPoint | null) => {
    const wasCancelled = cancelledRef.current;
    activeIdRef.current = null;
    setActiveId(null);
    cancelledRef.current = false;
    if (enabled && !wasCancelled) onDragEnd(id as HomeCardId, point);
  };

  const handleCancel = () => {
    if (!activeIdRef.current) return;
    activeIdRef.current = null;
    setActiveId(null);
    cancelledRef.current = false;
    onDragCancel();
  };

  return (
    <DndContext
      sensors={sensors}
      autoScroll={enabled}
      onDragStart={(event) => handleStart(String(event.active.id))}
      onDragMove={(event) => handleMove(String(event.active.id), pointForDragEvent(event))}
      onDragEnd={(event) => handleEnd(String(event.active.id), pointForDragEvent(event))}
      onDragCancel={handleCancel}
    >
      <HomeDragContext.Provider value={{ enabled }}>
        {children(activeId)}
        <DragOverlay className={styles.dragOverlay} dropAnimation={null}>
          {activeId ? overlay(activeId) : null}
        </DragOverlay>
      </HomeDragContext.Provider>
    </DndContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- 轉接層也提供 hook，讓卡片只取得綁定而不匯入套件。
export function useHomeCardDrag(cardId: HomeCardId): DragHandleBindings {
  const { enabled } = useContext(HomeDragContext);
  const drag = useDraggable({ id: cardId, disabled: !enabled });
  return {
    attributes: drag.attributes,
    listeners: drag.listeners,
    setNodeRef: drag.setNodeRef,
    setActivatorNodeRef: drag.setActivatorNodeRef,
    isDragging: drag.isDragging,
  };
}

function pointForDragEvent(event: {
  activatorEvent: Event;
  delta: { x: number; y: number };
}): DragPoint | null {
  const start = clientPoint(event.activatorEvent);
  return start
    ? { clientX: start.clientX + event.delta.x, clientY: start.clientY + event.delta.y }
    : null;
}

function clientPoint(event: Event): DragPoint | null {
  if ('clientX' in event && 'clientY' in event) {
    return { clientX: Number(event.clientX), clientY: Number(event.clientY) };
  }
  if ('changedTouches' in event) {
    const touch = (event.changedTouches as TouchList)[0];
    if (touch) return { clientX: touch.clientX, clientY: touch.clientY };
  }
  return null;
}
