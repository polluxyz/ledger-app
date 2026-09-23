import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarCollapsed, useSidebarFloatingRange } from './use-sidebar-collapsed';

/**
 * 側欄收合的記憶（phase-2h D11、SC-24.2）。
 *
 * 驗四件事：預設展開、切換會寫進 localStorage（鍵名 `ledger.sidebarCollapsed`
 * 在這裡用字面值釘住——它對 CSS 與未來的維護者都是契約）、重新掛載讀得回上次
 * 的選擇、localStorage 不能用時不拋錯且照樣切換。
 */
describe('useSidebarCollapsed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to expanded when nothing was stored', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(false);
  });

  it('persists the collapse choice to localStorage', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => result.current.toggle());

    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem('ledger.sidebarCollapsed')).toBe('true');
  });

  it('removes the stored value when expanded again', () => {
    localStorage.setItem('ledger.sidebarCollapsed', 'true');
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => result.current.toggle());

    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem('ledger.sidebarCollapsed')).toBeNull();
  });

  it('restores the saved choice on the next mount', () => {
    // 「重新整理後仍保留」在 jsdom 裡的等價說法：新的 hook 實例重讀 localStorage。
    localStorage.setItem('ledger.sidebarCollapsed', 'true');

    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(true);
  });

  it('treats a throwing localStorage as expanded without crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(false);

    // 讀寫都失敗，畫面還是要能收合（只是這次瀏覽記不住）。
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});

/**
 * 901–1199px 的偵測（2i · D27）。
 *
 * 這是「斷點只存在 CSS」的唯一例外：那個區間的展開不寫 localStorage，
 * 該不該寫只有 JS 判斷得了。驗兩件事——查得到時照媒體查詢的結果回答，
 * jsdom 沒有 `matchMedia` 時回 false（＝當成 ≥ 1200px，走推擠 ＋ 記憶那套）。
 */
describe('useSidebarFloatingRange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  it('reports false when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useSidebarFloatingRange());

    expect(result.current).toBe(false);
  });

  it('follows the media query when the browser provides one', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useSidebarFloatingRange());

    expect(result.current).toBe(true);
  });

  it('reports false outside the range', () => {
    stubMatchMedia(false);

    const { result } = renderHook(() => useSidebarFloatingRange());

    expect(result.current).toBe(false);
  });
});
