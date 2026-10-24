import { validateEnv } from './env.validation';

/**
 * 環境變數 schema 的單元測試。
 *
 * 重點全部放在 `CORS_ORIGIN`——它是一條安全邊界（決定哪些網頁可以打這個 API），
 * 而 2g 讓它從「一個字串」變成「逗號分隔的清單」。這個改動最可能出的錯是
 * **不小心放寬了比對**：把整串當成一個來源、沒有去掉空白、或空字串被當成有效來源。
 * 下面每一條都在釘那件事。
 */
describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
  };

  it.each([
    ['AI_PARSE_DAILY_LIMIT_PER_USER', 50, 10000, 0],
    ['AI_DAILY_LIMIT_GLOBAL', 500, 1000000, 0],
    ['AI_PARSE_MAX_OUTPUT_TOKENS', 2048, 32768, 256],
  ] as const)('SC-P23.4: validates %s boundaries and blank defaults', (key, fallback, max, min) => {
    for (const blank of [undefined, '', '  ']) {
      expect(validateEnv({ ...base, [key]: blank })[key]).toBe(fallback);
    }
    for (const value of ['-1', '1.5', 'abc', String(max + 1)]) {
      expect(() => validateEnv({ ...base, [key]: value })).toThrow(key);
    }
    expect(validateEnv({ ...base, [key]: String(min) })[key]).toBe(min);
    expect(validateEnv({ ...base, [key]: String(max) })[key]).toBe(max);
    if (min > 0) expect(() => validateEnv({ ...base, [key]: '0' })).toThrow(key);
  });

  it('defaults AI to fake without requiring external credentials', () => {
    expect(validateEnv(base)).toMatchObject({
      LLM_PROVIDER: 'fake',
      GLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
    });
  });

  it('allows missing or blank GLM credentials at startup', () => {
    expect(validateEnv({ ...base, LLM_PROVIDER: 'glm' }).LLM_PROVIDER).toBe('glm');
    expect(
      validateEnv({ ...base, LLM_PROVIDER: 'glm', GLM_API_KEY: '', GLM_MODEL: '' }).GLM_API_KEY,
    ).toBe('');
  });

  it('treats a missing or blank reasoning effort as unset and rejects unknown values', () => {
    expect(validateEnv(base).GLM_REASONING_EFFORT).toBeUndefined();
    expect(validateEnv({ ...base, GLM_REASONING_EFFORT: '  ' }).GLM_REASONING_EFFORT).toBe(
      undefined,
    );
    expect(validateEnv({ ...base, GLM_REASONING_EFFORT: 'low' }).GLM_REASONING_EFFORT).toBe('low');
    expect(() => validateEnv({ ...base, GLM_REASONING_EFFORT: 'minimal' })).toThrow(
      /GLM_REASONING_EFFORT/,
    );
  });

  it('rejects unknown providers instead of silently selecting fake', () => {
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'unknown' })).toThrow(/LLM_PROVIDER/);
  });

  it('keeps a single origin as a one-item list', () => {
    const env = validateEnv({ ...base, CORS_ORIGIN: 'https://app.example.com' });

    // `main.ts` 一律拿到陣列，不必在那裡再判斷一次形狀。
    expect(env.CORS_ORIGIN).toEqual(['https://app.example.com']);
  });

  it('splits a comma-separated list and trims each entry', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGIN: 'https://app.example.com, https://staging.example.com',
    });

    // 沒有 trim 的話，第二筆會帶著開頭空白，永遠比對不到——而且不會有任何錯誤訊息。
    expect(env.CORS_ORIGIN).toEqual(['https://app.example.com', 'https://staging.example.com']);
  });

  it('drops empty entries from a sloppy list', () => {
    const env = validateEnv({ ...base, CORS_ORIGIN: 'https://app.example.com,,  ,' });

    // 空字串若留下來就是一筆永遠比對不到的垃圾，但更糟的是它讓清單長度誤導人。
    expect(env.CORS_ORIGIN).toEqual(['https://app.example.com']);
  });

  it('rejects a value that contains no usable origin', () => {
    expect(() => validateEnv({ ...base, CORS_ORIGIN: ' , , ' })).toThrow(/CORS_ORIGIN/);
  });

  it('falls back to the Vite dev server when unset', () => {
    const env = validateEnv({ ...base });

    expect(env.CORS_ORIGIN).toEqual(['http://localhost:5173']);
  });
});
