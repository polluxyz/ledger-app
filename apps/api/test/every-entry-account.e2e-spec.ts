import { INestApplication } from '@nestjs/common';
import type { LedgerSummary } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, httpServer, listAccounts, registerAndLogin, resetDb } from './e2e-utils';

/** SC-H2、SC-H9：驗證帳本不再提供餘額開關，以及註冊建立且鎖定唯一的臨時帳戶。 */
describe('Every entry has an account — ledger option and temporary account (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('SC-H2: rejects tracksBalance at creation and omits it from ledger responses', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '不計入餘額', kind: 'SHARED', tracksBalance: false })
      .expect(400);

    const ledgers = await request(server()).get('/api/ledgers').set(auth(alice.token)).expect(200);
    expect((ledgers.body as LedgerSummary[]).length).toBeGreaterThan(0);
    const rows = ledgers.body as Array<Record<string, unknown>>;
    expect(rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'tracksBalance'))).toBe(
      true,
    );
  });

  it('SC-H9: registration creates one last-listed temporary account that cannot be renamed or deleted', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const accounts = await listAccounts(app, alice.token);
    const temporary = accounts.filter((account) => account.isTemporary);
    expect(temporary).toHaveLength(1);
    expect(accounts.at(-1)?.id).toBe(temporary[0]!.id);

    const renamed = await request(server())
      .patch(`/api/accounts/${temporary[0]!.id}`)
      .set(auth(alice.token))
      .send({ name: '改名' })
      .expect(409);
    expect(renamed.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_LOCKED' });

    const deleted = await request(server())
      .delete(`/api/accounts/${temporary[0]!.id}`)
      .set(auth(alice.token))
      .expect(409);
    expect(deleted.body).toMatchObject({ errorCode: 'TEMPORARY_ACCOUNT_LOCKED' });

    const after = (await listAccounts(app, alice.token)).filter((account) => account.isTemporary);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(temporary[0]!.id);
  });
});
