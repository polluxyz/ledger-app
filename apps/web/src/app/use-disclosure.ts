import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * 一個「點按鈕展開、再點一次收起」的浮動面板（popover）。
 *
 * 目前只有窄螢幕的導覽選單在用，但刻意抽成 hook——日後若再出現第二組選單
 * （例如帳本切換、使用者選單各自展開），直接套用即可，不必再解一次
 * 「點外面要關」這個問題（見 `tasks/phase-2f-plan.md` D7）。
 *
 * **這不是 modal，所以刻意不鎖焦點（focus trap）。** 全屏抽屜必須鎖焦點，
 * 而鎖壞了使用者就用鍵盤跳不出去；浮動面板沒有這個義務，鎖了反而製造那個問題。
 * 面板背後的內容仍然可以正常操作，那是 popover 該有的樣子。
 */
export type Disclosure = ReturnType<typeof useDisclosure>;

export function useDisclosure() {
  const [isOpen, setIsOpen] = useState(false);
  // 面板與觸發鈕之間的關聯要有一個穩定的 id，`aria-controls` 才指得過去。
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((open) => !open), []);

  useEffect(() => {
    // 關著的時候不掛監聽。全站永遠掛著兩個 document 層級的 handler 是浪費，
    // 而且每次點擊都要多跑一次判斷。
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      // 點在面板裡面：那是正常操作，不關。
      if (panelRef.current?.contains(target)) {
        return;
      }
      // 點在觸發鈕上：交給它自己的 onClick 去 toggle。
      // 少了這一條，pointerdown 會先關閉，隨後的 click 又把它打開，
      // 結果是「再點一次收起」永遠沒有作用——而畫面看起來只是閃了一下。
      if (triggerRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      setIsOpen(false);
      // 焦點要退回觸發鈕。不做的話焦點會掉到 <body>，鍵盤使用者按 Tab
      // 會從整頁最上面重新開始，等於迷路。
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return {
    isOpen,
    toggle,
    close,
    /** 展開 / 收起的按鈕。展開後 `aria-expanded` 為 true，螢幕閱讀器才讀得出狀態。 */
    triggerProps: {
      ref: triggerRef,
      'aria-expanded': isOpen,
      'aria-controls': panelId,
      onClick: toggle,
    },
    /** 被展開的面板本身。 */
    panelProps: {
      ref: panelRef,
      id: panelId,
    },
  };
}
