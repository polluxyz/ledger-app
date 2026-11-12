import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));

/** 不連資料庫或監聽埠口，直接執行進入點以驗證不同部署環境的啟動設定。 */
describe('bootstrap', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it.each(['production', 'development', 'test'])('configures Swagger for %s', async (env) => {
    process.env.NODE_ENV = env;
    const app = {
      get: jest.fn().mockReturnValue({ get: jest.fn() }),
      enableCors: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
      useGlobalFilters: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as unknown as INestApplication);
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as never);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);

    // 只重跑 main，保留上述 mock 所在的模組實例。
    jest.resetModules();
    // resetModules 會換掉依賴，故以 doMock 明確共用這次的替身。
    jest.doMock('@nestjs/core', () => ({ NestFactory }));
    jest.doMock('@nestjs/swagger', () => ({
      ...jest.requireActual<object>('@nestjs/swagger'),
      SwaggerModule,
    }));
    jest.requireActual('./main');
    await Promise.resolve();

    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledTimes(env === 'production' ? 0 : 1);
    expect(setup).toHaveBeenCalledTimes(env === 'production' ? 0 : 1);
  });
});
