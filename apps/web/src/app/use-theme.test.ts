import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, readThemePreference, useTheme } from './use-theme';

/**
 * 深淺色偏好的 hook（phase-2h SC-29）。
 *
 * 驗三件事：循環順序、「選擇」同時寫進 localStorage 與 <html data-theme>、
 * 以及 localStorage 不能用時不拋錯（隱私模式真的會拋）。
 * 畫面顏色本身由 CSS 決定，不在這裡驗。
 */
describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts from system when nothing was chosen', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
  });

  it('restores a saved choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('light');
  });

  it('cycles system → light → dark → system', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('light');
    act(() => result.current.cycle());
    expect(result.current.preference).toBe('dark');
    act(() => result.current.cycle());
    expect(result.current.preference).toBe('system');
  });

  it('writes the choice to storage and to the <html> attribute', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.choose('dark'));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('removes both the stored value and the attribute when going back to system', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.choose('light'));

    act(() => result.current.choose('system'));

    // 移除而不是存成 'system'：theme-init.js 與 CSS 都把「沒有值」當成跟隨系統。
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('falls back to system when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(readThemePreference()).toBe('system');
  });

  it('still switches the page when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useTheme());

    act(() => result.current.choose('light'));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
