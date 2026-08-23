import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Account, AuthTokenResponse, AuthUser } from '@ledger/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * e2e 測試的共用工具。e2e 會啟動「真正的」應用程式，打真正的 HTTP 請求，並連到
 * 真實的測試資料庫（ledger_test），因此驗證的是端到端的實際行為，而非 mock。
 * 每個測試前用 resetDb 清空資料表，確保彼此獨立、可重跑。
 */

export const PASSWORD = 'sup3rsecret';

export interface E2EContext {
  app: INestApplication;
  prisma: PrismaService;
}

/** 具型別的 HTTP server 供 supertest 使用（否則 getHttpServer() 會是 `any`）。 */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/**
 * 用與 main.ts 相同的方式啟動真正的應用程式（全域前綴、pipe、filter），讓 e2e
 * 驗證的是正式環境的行為。限流在 NODE_ENV=test 下停用（見 ThrottlerModule 設定），
 * 以免密集的 auth 呼叫被限流。
 */
export async function createE2EApp(): Promise<E2EContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/**
 * 清空每張資料表，讓每個測試都從乾淨狀態開始（CASCADE 一併清掉關聯資料）。
 *
 * **新增資料表時務必補進這份清單**——漏掉的症狀很難認：單獨跑會過，整套跑才爛，
 * 因為前一個測試留下的資料汙染了後面的。
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Transaction", "Category", "Account", "LedgerMember", "Ledger", "User" RESTART IDENTITY CASCADE',
  );
}

/** 註冊後隨即登入一位使用者，回傳其 token 與 id。 */
export async function registerAndLogin(
  app: INestApplication,
  email: string,
  name = 'User',
): Promise<{ token: string; userId: string }> {
  const server = httpServer(app);
  const registered = await request(server)
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, name });
  const userId = (registered.body as AuthUser).id;

  const loggedIn = await request(server)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  const token = (loggedIn.body as AuthTokenResponse).accessToken;

  return { token, userId };
}

/** 取得使用者第一個（註冊時自動建立的個人）帳本 id。 */
export async function firstLedgerId(app: INestApplication, token: string): Promise<string> {
  const res = await request(httpServer(app))
    .get('/api/ledgers')
    .set('Authorization', `Bearer ${token}`);
  return (res.body as Array<{ id: string }>)[0]!.id;
}

/**
 * 建立一本**共享**帳本並回傳其 id。
 *
 * 任何要加入成員的測試都必須用它，不能用 `firstLedgerId`——註冊自動建立的帳本是
 * `PERSONAL`，加成員會被擋成 409 `PERSONAL_LEDGER_CANNOT_SHARE`（2d）。
 */
export async function createSharedLedger(
  app: INestApplication,
  token: string,
  name = 'Shared',
): Promise<string> {
  const res = await request(httpServer(app))
    .post('/api/ledgers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, kind: 'SHARED' });
  return (res.body as { id: string }).id;
}

/** 取得使用者的帳戶清單（註冊時自動建立的預設「現金」會是第一筆）。 */
export async function listAccounts(app: INestApplication, token: string): Promise<Account[]> {
  const res = await request(httpServer(app))
    .get('/api/accounts')
    .set('Authorization', `Bearer ${token}`);
  return res.body as Account[];
}

/** 取得使用者預設「現金」帳戶的 id——連動帳本記帳時的必填欄位。 */
export async function firstAccountId(app: INestApplication, token: string): Promise<string> {
  const accounts = await listAccounts(app, token);
  return accounts[0]!.id;
}
