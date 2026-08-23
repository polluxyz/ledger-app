import { INestApplication } from '@nestjs/common';
import { LedgerMemberInfo, LedgerSummary } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  createSharedLedger,
  firstAccountId,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 帳本與成員的 e2e：資料隔離（非成員一律 404）、owner 加成員並依角色把關寫入、
 * 加入未知／重複 email、最後 owner 保護、刪除需 confirm 相符，以及 2c 的連動設定、
 * 封存與刪除規則。此檔集中驗證安全性防線的「對外實際表現」。
 */
describe('Ledgers & members (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('isolates ledgers: a non-member sees 404, never 403', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await registerAndLogin(app, 'bob@example.com', 'Bob');
    const bob = await request(server())
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'sup3rsecret' });
    const bobToken = (bob.body as { accessToken: string }).accessToken;

    const ledgerId = await firstLedgerId(app, alice.token);
    const res = await request(server()).get(`/api/ledgers/${ledgerId}`).set(auth(bobToken));

    expect(res.status).toBe(404);
  });

  it('lets an owner add a member and enforces role on writes', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    // 共享帳本才加得了成員——註冊自動建立的那本是私人的（2d）。
    const ledgerId = await createSharedLedger(app, alice.token, 'Household');

    const added = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });
    expect(added.status).toBe(201);
    expect((added.body as LedgerMemberInfo).role).toBe('VIEWER');

    // viewer 不能改帳本名稱（需 OWNER）。
    const denied = await request(server())
      .patch(`/api/ledgers/${ledgerId}`)
      .set(auth(bob.token))
      .send({ name: 'Hacked' });
    expect(denied.status).toBe(403);

    // owner 可以。
    const renamed = await request(server())
      .patch(`/api/ledgers/${ledgerId}`)
      .set(auth(alice.token))
      .send({ name: 'Household' });
    expect(renamed.status).toBe(200);
  });

  it('rejects adding an unknown email (404) or an existing member (409)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await createSharedLedger(app, alice.token);

    const unknown = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'ghost@example.com', role: 'VIEWER' });
    expect(unknown.status).toBe(404);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });
    const dup = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });
    expect(dup.status).toBe(409);
  });

  it('protects the last owner from demotion and self-removal', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const demote = await request(server())
      .patch(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
      .set(auth(alice.token))
      .send({ role: 'EDITOR' });
    expect(demote.status).toBe(409);

    const leave = await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${alice.userId}`)
      .set(auth(alice.token));
    expect(leave.status).toBe(409);
  });

  it('deletes a ledger only with a matching confirm', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: 'Trip' });
    const ledger = created.body as LedgerSummary;

    const wrong = await request(server())
      .delete(`/api/ledgers/${ledger.id}?confirm=nope`)
      .set(auth(alice.token));
    expect(wrong.status).toBe(400);

    const ok = await request(server())
      .delete(`/api/ledgers/${ledger.id}?confirm=Trip`)
      .set(auth(alice.token));
    expect(ok.status).toBe(204);
  });

  // ── 2c：連動設定、封存、刪除規則 ──────────────────────────────────────────

  it('fixes tracksBalance at creation (SC-C12)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '出遊分帳', tracksBalance: false });
    const ledger = created.body as LedgerSummary;
    expect(ledger.tracksBalance).toBe(false);
    expect(ledger.archivedAt).toBeNull();

    const changed = await request(server())
      .patch(`/api/ledgers/${ledger.id}`)
      .set(auth(alice.token))
      .send({ name: '出遊分帳', tracksBalance: true });
    expect(changed.status).toBe(400);
    expect((changed.body as { errorCode: string }).errorCode).toBe('TRACKS_BALANCE_IMMUTABLE');
  });

  it('archives a ledger: read-only, and hidden from the default list (SC-C10)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);
    const accountId = await firstAccountId(app, alice.token);
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories?type=EXPENSE`)
      .set(auth(alice.token));
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;

    const archived = await request(server())
      .post(`/api/ledgers/${ledgerId}/archive`)
      .set(auth(alice.token));
    expect(archived.status).toBe(201);
    expect((archived.body as { archivedAt: string | null }).archivedAt).not.toBeNull();

    // 寫入被擋下。
    const write = await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2026-08-13T00:00:00.000Z',
        categoryId,
        accountId,
      });
    expect(write.status).toBe(409);
    expect((write.body as { errorCode: string }).errorCode).toBe('LEDGER_ARCHIVED');

    // 讀取照常——封存的用意是收起來，不是讓歷史消失。
    const read = await request(server())
      .get(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token));
    expect(read.status).toBe(200);

    // 預設清單不含它，帶 includeArchived 才出現。
    const listed = await request(server()).get('/api/ledgers').set(auth(alice.token));
    expect((listed.body as LedgerSummary[]).map((l) => l.id)).not.toContain(ledgerId);

    const withArchived = await request(server())
      .get('/api/ledgers?includeArchived=true')
      .set(auth(alice.token));
    expect((withArchived.body as LedgerSummary[]).map((l) => l.id)).toContain(ledgerId);
  });

  it("refuses to delete a ledger holding other members' transactions (SC-C11)", async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: 'Family', kind: 'SHARED' });
    const ledgerId = (created.body as LedgerSummary).id;

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });

    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories?type=EXPENSE`)
      .set(auth(alice.token));
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;
    const bobAccountId = await firstAccountId(app, bob.token);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(bob.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2026-08-13T00:00:00.000Z',
        categoryId,
        accountId: bobAccountId,
      });

    // 刪掉會讓 Bob 的交易一起消失，他的餘額被回溯性改變。
    const blocked = await request(server())
      .delete(`/api/ledgers/${ledgerId}?confirm=Family`)
      .set(auth(alice.token));
    expect(blocked.status).toBe(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe(
      'LEDGER_HAS_OTHERS_TRANSACTIONS',
    );
  });

  // ── 帳本類型（2d） ────────────────────────────────────────────────────────

  it('defaults a new ledger to personal and honours an explicit kind (SC-D1)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const omitted = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '沒說類型' });
    expect(omitted.status).toBe(201);
    expect((omitted.body as LedgerSummary).kind).toBe('PERSONAL');

    const shared = await request(server())
      .post('/api/ledgers')
      .set(auth(alice.token))
      .send({ name: '家庭帳本', kind: 'SHARED' });
    expect((shared.body as LedgerSummary).kind).toBe('SHARED');
  });

  it('creates the registration ledger as personal (SC-D6)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');

    const listed = await request(server()).get('/api/ledgers').set(auth(alice.token));
    expect((listed.body as LedgerSummary[])[0]!.kind).toBe('PERSONAL');
  });

  it('refuses to change kind after creation (SC-D2)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const res = await request(server())
      .patch(`/api/ledgers/${ledgerId}`)
      .set(auth(alice.token))
      .send({ name: '改個名', kind: 'SHARED' });
    expect(res.status).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('LEDGER_KIND_IMMUTABLE');

    // 名稱也不該被順手改掉——整個請求被拒絕，不是部分套用。
    const after = await request(server()).get(`/api/ledgers/${ledgerId}`).set(auth(alice.token));
    expect((after.body as LedgerSummary).kind).toBe('PERSONAL');
    expect((after.body as LedgerSummary).name).not.toBe('改個名');
  });

  it('refuses to add a member to a personal ledger (SC-D3)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    await registerAndLogin(app, 'bob@example.com', 'Bob');
    // owner 本人呼叫也一樣被擋：這不是權限問題，是帳本類型不允許。
    const ledgerId = await firstLedgerId(app, alice.token);

    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });
    expect(res.status).toBe(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('PERSONAL_LEDGER_CANNOT_SHARE');

    const members = await request(server())
      .get(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token));
    expect(members.body as LedgerMemberInfo[]).toHaveLength(1);
  });

  it('does not leak whether an email is registered on a personal ledger (SC-D3)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    // 帳本類型的檢查排在查詢使用者之前，所以這裡不會回 USER_NOT_FOUND。
    const res = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'ghost@example.com', role: 'EDITOR' });
    expect((res.body as { errorCode: string }).errorCode).toBe('PERSONAL_LEDGER_CANNOT_SHARE');
  });

  it('keeps a shared ledger shared after everyone else leaves (SC-D5)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await createSharedLedger(app, alice.token, 'Trip');

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });

    // Bob 自行退出，帳本只剩 Alice 一個人。
    const left = await request(server())
      .delete(`/api/ledgers/${ledgerId}/members/${bob.userId}`)
      .set(auth(bob.token));
    expect(left.status).toBe(204);

    const detail = await request(server()).get(`/api/ledgers/${ledgerId}`).set(auth(alice.token));
    expect((detail.body as LedgerSummary).kind).toBe('SHARED');

    // 而且還加得回人——這正是「不能用成員數推導 kind」的證據。
    const readded = await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'EDITOR' });
    expect(readded.status).toBe(201);
  });
});
