import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AiUserThrottleGuard } from './ai-user-throttle.guard';

/** 真實記憶體 storage 驗證獨立 ai-user 配額，無 JWT 時即使測試跳過計數也必須拒絕。 */
describe('AiUserThrottleGuard', () => {
  const previous = process.env.NODE_ENV;
  let storage: ThrottlerStorageService;
  let guard: AiUserThrottleGuard;
  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    guard = new AiUserThrottleGuard(
      { throttlers: [{ name: 'default', ttl: 60000, limit: 100 }] },
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
  });
  afterEach(() => {
    process.env.NODE_ENV = previous;
    storage.onApplicationShutdown();
  });
  class Controller {}
  function handler() {}
  const context = (sub?: string): ExecutionContext =>
    ({
      getClass: () => Controller,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ user: sub ? { sub } : undefined, headers: {}, ip: 'same-ip' }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;
  it('requires a verified user even when throttling is skipped', async () => {
    process.env.NODE_ENV = 'test';
    await expect(guard.canActivate(context())).rejects.toMatchObject({ status: 401 });
  });
  it('has separate ten-request limits for two users with the same IP', async () => {
    process.env.NODE_ENV = 'ai-throttle-test';
    for (let index = 0; index < 10; index += 1) {
      await expect(guard.canActivate(context('alice'))).resolves.toBe(true);
      await expect(guard.canActivate(context('bob'))).resolves.toBe(true);
    }
    await expect(guard.canActivate(context('alice'))).rejects.toMatchObject({ status: 429 });
    await expect(guard.canActivate(context('bob'))).rejects.toMatchObject({ status: 429 });
  });
});
