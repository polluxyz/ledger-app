import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthTokenResponse, AuthUser } from '@ledger/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'sup3rsecret';

export interface E2EContext {
  app: INestApplication;
  prisma: PrismaService;
}

/** Typed HTTP server for supertest (getHttpServer() is otherwise `any`). */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/**
 * Boots the real application the same way main.ts does (global prefix, pipe,
 * filter) so e2e exercises production behaviour. Rate limiting is skipped under
 * NODE_ENV=test (see ThrottlerModule config) so repeated auth calls aren't
 * throttled.
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

/** Empties every table so each test starts from a clean slate. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Transaction", "Category", "LedgerMember", "Ledger", "User" RESTART IDENTITY CASCADE',
  );
}

/** Registers then logs a user in, returning their token and id. */
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

/** The id of a user's first (auto-provisioned personal) ledger. */
export async function firstLedgerId(app: INestApplication, token: string): Promise<string> {
  const res = await request(httpServer(app))
    .get('/api/ledgers')
    .set('Authorization', `Bearer ${token}`);
  return (res.body as Array<{ id: string }>)[0]!.id;
}
