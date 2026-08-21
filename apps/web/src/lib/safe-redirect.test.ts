import { describe, expect, it } from 'vitest';
import { toSafeRedirect } from './safe-redirect';

/**
 * 開放轉址（open redirect）的防護。
 *
 * 這個函式唯一的工作是「不要把使用者送出站外」，所以測試就是一張攻擊清單。
 * 每一種形式各一條，不合併——合併之後失敗訊息只會說「有一個沒擋到」。
 */
describe('toSafeRedirect', () => {
  it('keeps an ordinary in-site path', () => {
    expect(toSafeRedirect('/accounts')).toBe('/accounts');
  });

  it('keeps the query string along with the path', () => {
    expect(toSafeRedirect('/accounts?page=2')).toBe('/accounts?page=2');
  });

  it('rejects a protocol-relative URL', () => {
    // 最容易漏的一種：它確實以 / 開頭，但瀏覽器會把它當成 https://evil.example。
    expect(toSafeRedirect('//evil.example')).toBe('/');
    expect(toSafeRedirect('//evil.example/login')).toBe('/');
  });

  it('rejects an absolute URL', () => {
    expect(toSafeRedirect('https://evil.example')).toBe('/');
    expect(toSafeRedirect('http://evil.example/pay')).toBe('/');
  });

  it('rejects a javascript: URL', () => {
    expect(toSafeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('rejects a path that does not start with a slash', () => {
    expect(toSafeRedirect('accounts')).toBe('/');
  });

  it('falls back to the home page for anything that is not a string', () => {
    expect(toSafeRedirect(undefined)).toBe('/');
    expect(toSafeRedirect(null)).toBe('/');
    expect(toSafeRedirect('')).toBe('/');
    expect(toSafeRedirect({ from: '/accounts' })).toBe('/');
  });
});
