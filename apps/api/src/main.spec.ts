import type { Server } from 'node:http';
import * as NestCommon from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@ledger/shared';
import request from 'supertest';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';

jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('./auth/auth.service', () => ({ AuthService: class AuthService {} }));

const webOrigin = 'https://web.example.test';
const credentials = { email: 'test@example.test', password: 'test-password' };
const loginResponse = { accessToken: 'test-token' };

/** 執行正式啟動設定並驗證 HTTP 回應；只替換登入服務和資料庫所在模組。 */
describe.each(['production', 'development', 'test'])('bootstrap (%s)', (env) => {
  let app: NestCommon.INestApplication<Server>;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = env;
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'CORS_ORIGIN' ? [webOrigin] : undefined) },
        },
        {
          provide: AuthService,
          useValue: {
            login: ({ password }: typeof credentials) =>
              password === credentials.password
                ? Promise.resolve(loginResponse)
                : Promise.reject(
                    new NestCommon.UnauthorizedException('Invalid email or password.'),
                  ),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestCommon.INestApplication<Server>>({ logger: false });
    let initialization: Promise<NestCommon.INestApplication> | undefined;
    const listen = jest
      .spyOn(app, 'listen')
      .mockImplementation(() => (initialization = app.init()));
    const shutdownHooks = jest.spyOn(app, 'enableShutdownHooks');
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app);

    // 重新執行進入點，共用應用程式已載入的例外型別與設定服務。
    jest.resetModules();
    jest.doMock('@nestjs/common', () => NestCommon);
    jest.doMock('@nestjs/config', () => ({ ConfigService }));
    jest.doMock('@nestjs/core', () => ({
      ...jest.requireActual<object>('@nestjs/core'),
      NestFactory,
    }));
    jest.requireActual('./main');
    await Promise.resolve();
    expect(shutdownHooks).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
    await initialization;
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it.each([200, 401])('adds security headers to login response %s', async (status) => {
    const password = status === 200 ? credentials.password : 'wrong-password';
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ ...credentials, password })
      .expect(status);

    expect({
      'x-content-type-options': response.headers['x-content-type-options'],
      'referrer-policy': response.headers['referrer-policy'],
    }).toEqual({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });

  it('keeps the login response and cross-origin access', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', webOrigin)
      .send(credentials)
      .expect('Access-Control-Allow-Origin', webOrigin)
      .expect(200, loginResponse);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ ...credentials, password: 'wrong-password' })
      .expect(401, {
        statusCode: 401,
        errorCode: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password.',
      });
  });

  it('keeps preflight behavior for allowed and unlisted origins', async () => {
    const preflight = (origin: string) =>
      request(app.getHttpServer())
        .options('/api/auth/login')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

    const allowed = await preflight(webOrigin)
      .expect(204)
      .expect('Access-Control-Allow-Origin', webOrigin)
      .expect('Access-Control-Allow-Headers', 'authorization,content-type');
    const unlisted = await preflight('https://unlisted.example.test').expect(204);
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps Swagger routes and assets available only outside production', async () => {
    const status = env === 'production' ? 404 : 200;
    const page = await request(app.getHttpServer()).get('/docs').expect(status);
    const spec = await request(app.getHttpServer()).get('/docs-json').expect(status);
    const script = await request(app.getHttpServer())
      .get('/docs/swagger-ui-bundle.js')
      .expect(status);
    const styles = await request(app.getHttpServer()).get('/docs/swagger-ui.css').expect(status);

    if (env !== 'production') {
      expect(page.text).toContain('swagger-ui-init.js');
      expect(page.headers['content-security-policy']).toBeUndefined();
      expect(script.headers['content-type']).toMatch(/javascript/);
      expect(styles.headers['content-type']).toMatch(/text\/css/);
      await request(app.getHttpServer()).get('/docs/swagger-ui-init.js').expect(200);
      expect(spec.body).toMatchObject({ paths: { '/api/auth/login': { post: {} } } });
    }
  });
});
