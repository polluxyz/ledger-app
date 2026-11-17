import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyKey } from './idempotency-key';

// 驗證沒有 randomUUID 時仍可產生合法的 UUID v4。
describe('SC-IK15', () => {
  it('沒有 crypto.randomUUID 仍產生合法 UUID v4', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    vi.unstubAllGlobals();
  });
});
