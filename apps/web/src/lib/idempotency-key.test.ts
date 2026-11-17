/** 驗證非安全環境仍可建立防重鍵，並在測試後還原瀏覽器介面。 */
import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyKey } from './idempotency-key';

// 驗證沒有 randomUUID 時仍可產生合法的 UUID v4。
describe('SC-IK15', () => {
  it('沒有 crypto.randomUUID 仍產生合法 UUID v4', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      expect(createIdempotencyKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
