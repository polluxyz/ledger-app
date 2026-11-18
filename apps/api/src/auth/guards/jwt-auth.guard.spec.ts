import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

interface MockRequest {
  headers: { authorization?: string };
  user?: unknown;
}

function contextFor(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/**
 * JwtAuthGuard 的單元測試。用假的 ExecutionContext／Reflector／JwtService 驗證：
 * @Public 路由免 token、缺標頭或非 Bearer 一律拒絕、無效／過期 token 拒絕、
 * 有效 token 與登入紀錄才放行，只把 sub、email、sid 掛到 request（不讓 iat/exp 滲入）。
 */
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let jwt: { verifyAsync: jest.Mock };
  let prisma: { authSession: { findUnique: jest.Mock } };
  const payload = { sub: 'user-1', email: 'alice@example.com', sid: 'session-1', exp: 2 };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    jwt = { verifyAsync: jest.fn() };
    prisma = {
      authSession: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
  });

  it('allows public routes without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: MockRequest = { headers: {} };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const request: MockRequest = { headers: { authorization: 'Basic abc' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const request: MockRequest = { headers: { authorization: 'Bearer bad' } };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a valid token and attaches the user to the request', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'alice@example.com',
      sid: 'session-1',
      iat: 1,
      exp: 2,
    });
    const request: MockRequest = { headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    // 只有 sub、email、sid 會被複製到 request（iat/exp 不會滲漏進去）。
    expect(request.user).toEqual({ sub: 'user-1', email: 'alice@example.com', sid: 'session-1' });
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } });
  });

  it.each([
    { ...payload, sid: undefined },
    { ...payload, exp: undefined },
    { ...payload, sub: 1 },
    { ...payload, sub: '' },
    { ...payload, sid: 1 },
    { ...payload, sid: '' },
    { ...payload, email: 1 },
    { ...payload, email: '' },
    { ...payload, exp: '2' },
    { ...payload, exp: Infinity },
    { ...payload, exp: NaN },
    null,
  ])('rejects malformed payload %j before querying', async (invalid) => {
    jwt.verifyAsync.mockResolvedValue(invalid);
    const request: MockRequest = { headers: { authorization: 'Bearer bad' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      'Invalid or expired token',
    );
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it.each([
    null,
    { userId: 'other', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    { userId: 'user-1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    { userId: 'user-1', revokedAt: null, expiresAt: new Date(0) },
  ])('rejects an invalid session %j', async (session) => {
    jwt.verifyAsync.mockResolvedValue(payload);
    prisma.authSession.findUnique.mockResolvedValue(session);
    const request: MockRequest = { headers: { authorization: 'Bearer bad' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('rejects a session expiring exactly now', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T00:00:00Z'));
    try {
      jwt.verifyAsync.mockResolvedValue(payload);
      prisma.authSession.findUnique.mockResolvedValue({
        userId: payload.sub,
        revokedAt: null,
        expiresAt: new Date(),
      });
      const request: MockRequest = { headers: { authorization: 'Bearer bad' } };
      await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('SC-TV9: propagates database failure unchanged and never authorizes the request', async () => {
    const error = new Error('database unavailable');
    jwt.verifyAsync.mockResolvedValue(payload);
    prisma.authSession.findUnique.mockRejectedValue(error);
    const request: MockRequest = { headers: { authorization: 'Bearer good' } };
    const result = guard.canActivate(contextFor(request));
    await expect(result).rejects.toBe(error);
    await expect(result).rejects.not.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
