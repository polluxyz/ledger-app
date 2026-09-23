import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarCollapsed } from './use-sidebar-collapsed';

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
