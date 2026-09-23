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
