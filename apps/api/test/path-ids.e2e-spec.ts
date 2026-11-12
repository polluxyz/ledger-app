import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/** R13：實際送出格式錯誤的路徑 id；各領域應安全回 404，無須改動既有介面。 */
describe('Malformed path IDs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let ledgerId: string;
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    await resetDb(prisma);
    ({ token } = await registerAndLogin(app, 'ids@example.com'));
    ledgerId = await createSharedLedger(app, token);
  });
  afterAll(() => app.close());

  const routes = [
    ['get', '/ledgers/:id', undefined],
    ['patch', '/accounts/:id', { name: 'Bank' }],
    ['delete', '/accounts/:id', undefined],
    ['get', '/ledgers/:ledger/transactions/:id', undefined],
    ['patch', '/ledgers/:ledger/transactions/:id', { amount: 100 }],
    ['delete', '/ledgers/:ledger/categories/:id', undefined],
    ['patch', '/ledgers/:ledger/members/:id', { role: 'EDITOR' }],
    ['delete', '/ledgers/:ledger/people/:id', undefined],
    ['delete', '/ledgers/:ledger/settlements/:id', undefined],
    ['get', '/counterparties/:id', undefined],
    ['delete', '/debt-entries/:id', undefined],
    ['get', '/splits/:id', undefined],
    ['delete', '/friends/:id', undefined],
    ['post', '/friend-requests/:id/accept', undefined],
    ['post', '/debt-proposals/:id/accept', undefined],
  ] as const;
  describe.each(['not-a-uuid', '123', '%27%3B--'])('id = %s', (id) => {
    it.each(routes)('%s %s returns 404', async (method, path, body) => {
      const url = '/api' + path.replace(':ledger', ledgerId).replace(':id', id);
      const pending = request(httpServer(app))[method](url).set('Authorization', `Bearer ${token}`);
      if (body) pending.send(body);
      const response = await pending;
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ errorCode: 'NOT_FOUND' });
    });
  });
});
