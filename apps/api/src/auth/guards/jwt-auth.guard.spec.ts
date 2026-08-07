import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
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

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let jwt: { verifyAsync: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    jwt = { verifyAsync: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector, jwt as unknown as JwtService);
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
      iat: 1,
      exp: 2,
    });
    const request: MockRequest = { headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    // Only sub + email are copied onto the request (no iat/exp bleed-through).
    expect(request.user).toEqual({ sub: 'user-1', email: 'alice@example.com' });
  });
});
