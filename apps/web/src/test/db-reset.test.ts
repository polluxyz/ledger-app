import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../e2e/db';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  requireEnv: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
vi.mock('../../e2e/env', () => ({ requireEnv: mocks.requireEnv }));
vi.mock('node:timers/promises', () => ({
  default: { setTimeout: mocks.wait },
  setTimeout: mocks.wait,
}));

/** 模擬資料庫的回覆，驗證測試清理只重試死結，並保留其他錯誤。 */
describe('resetDb', () => {
  const truncate = 'TRUNCATE "Example" RESTART IDENTITY CASCADE';
  const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireEnv.mockReturnValue('postgresql://localhost/synthetic_test');
    mocks.query.mockResolvedValueOnce({ rows: [{ tablename: 'Example' }] });
  });

  it('normally truncates once and closes the client', async () => {
    await resetDb();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenLastCalledWith(truncate);
    expect(mocks.wait).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('retries one deadlock with the same statement and succeeds', async () => {
    mocks.query.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ rows: [] });
    await resetDb();
    expect(mocks.query.mock.calls.slice(1)).toEqual([[truncate], [truncate]]);
    expect(mocks.wait.mock.calls).toEqual([[50]]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('propagates another SQLSTATE immediately', async () => {
    const error = Object.assign(new Error('permission denied'), { code: '42501' });
    mocks.query.mockRejectedValueOnce(error);
    await expect(resetDb()).rejects.toBe(error);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.wait).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('throws the last deadlock after three failed attempts', async () => {
    const last = deadlock();
    mocks.query
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(last);
    await expect(resetDb()).rejects.toBe(last);
    expect(mocks.query.mock.calls.slice(1)).toEqual([[truncate], [truncate], [truncate]]);
    expect(mocks.wait.mock.calls).toEqual([[50], [100]]);
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('does not retry the table lookup even if it deadlocks', async () => {
    const error = deadlock();
    mocks.query.mockReset().mockRejectedValueOnce(error);
    await expect(resetDb()).rejects.toBe(error);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.wait).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('rejects a database without the test suffix before connecting', async () => {
    mocks.requireEnv.mockReturnValue('postgresql://localhost/synthetic');
    await expect(resetDb()).rejects.toThrow('_test');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
