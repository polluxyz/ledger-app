import { INestApplication } from '@nestjs/common';
import { AuthUser } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, PASSWORD, resetDb } from './e2e-utils';

/**
 * 認證與使用者流程的 e2e：涵蓋註冊（含自動建立個人帳本與預設分類）、重複 email、
 * 登入取 token 讀 profile、帳密錯誤不洩漏帳號是否存在、未認證存取受保護路由。
 */
describe('Auth & Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // 整個套件共用一個 app 實例；每個 it 之前清空資料庫確保互不干擾。
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const alice = { email: 'alice@example.com', password: PASSWORD, name: 'Alice' };

  it('registers a user, auto-provisions a personal ledger with default categories', async () => {
    const res = await request(server()).post('/api/auth/register').send(alice);

    expect(res.status).toBe(201);
    const body = res.body as AuthUser & { passwordHash?: string };
    expect(body).toMatchObject({ email: alice.email, name: 'Alice' });
    expect(body.passwordHash).toBeUndefined();

    // 恰好一個帳本、由該使用者擁有（OWNER），並灌入 12 個預設分類。
    const memberships = await prisma.ledgerMember.findMany({
      where: { userId: body.id },
    });
    expect(memberships).toHaveLength(1);
    const membership = memberships[0]!;
    expect(membership.role).toBe('OWNER');
    const categories = await prisma.category.count({
      where: { ledgerId: membership.ledgerId },
    });
    expect(categories).toBe(12);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(server()).post('/api/auth/register').send(alice);
    const res = await request(server()).post('/api/auth/register').send(alice);

    expect(res.status).toBe(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('logs in and reads the profile with the issued token', async () => {
    await request(server()).post('/api/auth/register').send(alice);
    const login = await request(server())
      .post('/api/auth/login')
      .send({ email: alice.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = (login.body as { accessToken: string }).accessToken;

    const me = await request(server()).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect((me.body as AuthUser).email).toBe(alice.email);
  });

  it('rejects wrong password and unknown email identically (401)', async () => {
    await request(server()).post('/api/auth/register').send(alice);

    const wrongPassword = await request(server())
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'nope-nope' });
    const unknownEmail = await request(server())
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('rejects an unauthenticated request to a protected route (401)', async () => {
    const res = await request(server()).get('/api/users/me');
    expect(res.status).toBe(401);
  });
});
