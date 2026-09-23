import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMotionEnabled, useMotion } from './use-motion';

/**
 * 動畫開關（spec 2i SC-39）。
 *
 * 驗四件事：預設開、關掉會寫 `<html data-motion="off">` 與 localStorage、
 * 重新掛載讀得回上次的選擇、localStorage 不能用時不拋錯且畫面照樣切換。
 * 鍵名 `ledger.motion` 用字面值釘住——`theme-init.js` 也寫死了它。
 */
describe('useMotion', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-motion');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is on by default', () => {
    const { result } = renderHook(() => useMotion());

    expect(result.current.enabled).toBe(true);
    expect(isMotionEnabled()).toBe(true);
  });

  it('turns motion off on the page and remembers it', () => {
    const { result } = renderHook(() => useMotion());

    act(() => result.current.setEnabled(false));

    expect(result.current.enabled).toBe(false);
    expect(document.documentElement).toHaveAttribute('data-motion', 'off');
    expect(localStorage.getItem('ledger.motion')).toBe('off');
    expect(isMotionEnabled()).toBe(false);
  });

  it('clears the stored value and the attribute when turned back on', () => {
    localStorage.setItem('ledger.motion', 'off');
    document.documentElement.setAttribute('data-motion', 'off');
    const { result } = renderHook(() => useMotion());
    expect(result.current.enabled).toBe(false);

    act(() => result.current.setEnabled(true));

    expect(document.documentElement).not.toHaveAttribute('data-motion');
    expect(localStorage.getItem('ledger.motion')).toBeNull();
  });

  it('still switches the page when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useMotion());
    expect(result.current.enabled).toBe(true);

    act(() => result.current.setEnabled(false));

    expect(document.documentElement).toHaveAttribute('data-motion', 'off');
  });
});
