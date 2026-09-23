import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/**
 * SC-F12：好友邀請的流量限制（每 IP 每分鐘 10 次，spec 決策 16）。
 *
 * 送出邀請會透露「這個 email 有沒有註冊」，限流限制的是逐一試 email 的速度（SEC-11）。
 *
 * 策略：其他 e2e 在 `NODE_ENV=test` 下停用限流（`app.module.ts` 的 `skipIf`），這個 suite
 * 自己暫時把 `NODE_ENV` 改掉讓限流生效，測完還原。`skipIf` 在每個請求時才判斷，所以改
 * 環境變數就夠，不必另建一套 app 設定。限流的計數存在 app 的記憶體裡，每個 suite 各自
 * 建立 app，不會互相影響。
 */
describe('Friend request rate limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    await resetDb(prisma);
  });
  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
  });

  it('the 11th invitation from one IP within a minute gets 429', async () => {
    // 先在限流停用時登入，別讓 auth 端點自己的限流（每分鐘 5 次）干擾。
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    process.env.NODE_ENV = 'throttle-test';

    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const res = await request(httpServer(app))
        .post('/api/friend-requests')
        .set({ Authorization: `Bearer ${alice.token}` })
        .send({ email: `nobody${attempt}@example.com` });
      statuses.push(res.status);
    }

    // 前 10 次是正常的「找不到這個使用者」，第 11 次被限流。
    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(404));
    expect(statuses[10]).toBe(429);
  });
});
