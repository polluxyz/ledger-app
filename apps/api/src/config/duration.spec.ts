import { parseDurationToMs } from './duration';
import { validateEnv } from './env.validation';

/** 以實際環境變數驗證格式，另驗算各單位與數值範圍的技術下限。 */
describe('JWT duration', () => {
  const config = { DATABASE_URL: 'test', JWT_SECRET: 'a'.repeat(32) };

  it.each(['0d', '-1d', '7', '7x', '', '1.5d', '7D'])('rejects %j', (value) => {
    expect(() => parseDurationToMs(value)).toThrow();
    expect(() => validateEnv({ ...config, JWT_EXPIRES_IN: value })).toThrow(
      '必須是正整數加 s、m、h、d，例如 7d',
    );
  });

  it.each([
    ['7d', 604_800_000],
    ['24h', 86_400_000],
    ['30m', 1_800_000],
    ['45s', 45_000],
  ])('accepts %s', (value, expected) => {
    expect(parseDurationToMs(value)).toBe(expected);
    expect(validateEnv({ ...config, JWT_EXPIRES_IN: value }).JWT_EXPIRES_IN).toBe(value);
  });

  it('defaults to 7d', () => {
    expect(validateEnv(config).JWT_EXPIRES_IN).toBe('7d');
  });

  it.each(['9007199254740992s', '999999999999999999999999999999999999d', '100000000d'])(
    'rejects an unsafe or unrepresentable duration %s',
    (value) => {
      expect(() => parseDurationToMs(value)).toThrow();
      expect(() => validateEnv({ ...config, JWT_EXPIRES_IN: value })).toThrow();
    },
  );
});
