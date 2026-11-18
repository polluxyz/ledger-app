import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  httpServer,
  loginAgain,
  PASSWORD,
  registerAndLogin,
  resetDb,
  signRawToken,
} from './e2e-utils';

/** 真實資料庫與 HTTP 驗證登入生命週期、清理與文件契約；負面回應也檢查資料未外洩。 */
describe('Auth session (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = 'session@example.com';

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  function payloadOf(token: string): { sub: string; sid: string; exp: number } {
    return new JwtService().decode<{ sub: string; sid: string; exp: number }>(token);
  }

  function expectNoUserData(response: Response, userId: string): void {
    expect(response.body).toMatchObject({ errorCode: 'UNAUTHORIZED' });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(email);
    expect(body).not.toContain(userId);
  }

  const me = (token: string) =>
    request(httpServer(app)).get('/api/users/me').set('Authorization', `Bearer ${token}`);
  const logout = (token: string) =>
    request(httpServer(app)).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

  it('SC-TV3: concurrent logins in one second create different sid values and two records', async () => {
    await request(httpServer(app))
      .post('/api/auth/register')
      .send({ email, name: 'Session', password: PASSWORD })
      .expect(201);
    // 固定簽發時鐘，排除測試恰好跨秒；實際 HTTP 與資料庫寫入仍同時執行。
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    let tokens: string[];
    try {
      tokens = await Promise.all([loginAgain(app, email), loginAgain(app, email)]);
    } finally {
      clock.mockRestore();
    }
    const [first, second] = tokens.map(payloadOf);
    expect(first!.sid).not.toBe(second!.sid);
    expect(first!.exp).toBe(second!.exp);
    expect(await prisma.authSession.count()).toBe(2);
    expect(await prisma.authSession.findMany({ select: { id: true } })).toEqual(
      expect.arrayContaining([{ id: first!.sid }, { id: second!.sid }]),
    );
  });

  it('SC-TV4: repeated and invalid logout leave every revocation timestamp unchanged', async () => {
    const { token, userId } = await registerAndLogin(app, email);
    await loginAgain(app, email);
    await logout(token).expect(204);
    const before = await prisma.authSession.findMany({ orderBy: { id: 'asc' } });

    const repeated = await logout(token).expect(401);
    const missing = await request(httpServer(app)).post('/api/auth/logout').expect(401);
    const invalid = await logout('garbage').expect(401);
    for (const response of [repeated, missing, invalid]) expectNoUserData(response, userId);
    expect(await prisma.authSession.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('SC-TV7.1: rejects an expired record while its token is still unexpired', async () => {
    const { token, userId } = await registerAndLogin(app, email);
    const payload = payloadOf(token);
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    await prisma.authSession.update({
      where: { id: payload.sid },
      data: { expiresAt: new Date(0) },
    });
    const before = await prisma.authSession.findUniqueOrThrow({ where: { id: payload.sid } });
    expectNoUserData(await me(token).expect(401), userId);
    expect(await prisma.authSession.findUniqueOrThrow({ where: { id: payload.sid } })).toEqual(
      before,
    );
  });

  it('SC-TV7.2: rejects an expired token while its record is still unexpired', async () => {
    const { token, userId } = await registerAndLogin(app, email);
    const payload = payloadOf(token);
    const before = await prisma.authSession.findUniqueOrThrow({ where: { id: payload.sid } });
    expect(before.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const expired = await signRawToken(app, {
      sub: userId,
      email,
      sid: payload.sid,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expectNoUserData(await me(expired).expect(401), userId);
    expect(await prisma.authSession.findUniqueOrThrow({ where: { id: payload.sid } })).toEqual(
      before,
    );
  });

  it('SC-TV8: keeps a revoked token invalid after a new API instance starts', async () => {
    const { token, userId } = await registerAndLogin(app, email);
    await logout(token).expect(204);
    const before = await prisma.authSession.findMany();
    await app.close();
    ({ app, prisma } = await createE2EApp());
    expectNoUserData(await me(token).expect(401), userId);
    expect(await prisma.authSession.findMany()).toEqual(before);
  });

  it('SC-TV10.1: uses exactly the same expiration second in the token and record', async () => {
    const { token } = await registerAndLogin(app, email);
    const payload = payloadOf(token);
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: payload.sid } });
    expect(session.expiresAt.getTime()).toBe(payload.exp * 1000);
  });

  it('SC-TV11.1-2: cleans expired records across users and retains revoked unexpired records', async () => {
    const { userId } = await registerAndLogin(app, 'other@example.com');
    const expired = await prisma.authSession.create({ data: { userId, expiresAt: new Date(0) } });
    const revoked = await prisma.authSession.create({
      data: { userId, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
    });
    await registerAndLogin(app, email);
    expect(await prisma.authSession.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.authSession.findUnique({ where: { id: revoked.id } })).toEqual(revoked);
  });

  it('SC-TV12: documents logout authentication and responses and preserves the login response', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'jwt').build(),
    );
    const operation = document.paths['/api/auth/logout']!.post!;
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty('204');
    expect(operation.responses).toHaveProperty('401');
    expect(operation.requestBody).toBeUndefined();
    // 登入原本沒有指定 DTO 回應 schema；保持原文件形狀，HTTP 契約仍為 accessToken。
    expect(document.paths['/api/auth/login']!.post!.responses).toEqual({
      '401': { description: 'Invalid email or password.' },
    });
    const { token } = await registerAndLogin(app, email);
    const response = await request(httpServer(app))
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(response.body).toEqual({ accessToken: expect.any(String) as string });
    expect(payloadOf(token).sid).toBeDefined();
  });

  it('confirms resetDb clears AuthSession records', async () => {
    await registerAndLogin(app, email);
    expect(await prisma.authSession.count()).toBe(1);
    await resetDb(prisma);
    expect(await prisma.authSession.count()).toBe(0);
  });

  it('confirms non-UUID sid returns null from Prisma and is rejected without changing data', async () => {
    const { userId } = await registerAndLogin(app, email);
    const before = await prisma.authSession.findMany();
    await expect(
      prisma.authSession.findUnique({ where: { id: 'not-a-uuid' } }),
    ).resolves.toBeNull();
    const token = await signRawToken(app, {
      sub: userId,
      email,
      sid: 'not-a-uuid',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expectNoUserData(await me(token).expect(401), userId);
    expect(await prisma.authSession.findMany()).toEqual(before);
  });
});
