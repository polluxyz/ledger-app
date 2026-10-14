import { performance } from 'node:perf_hooks';
import { INestApplication } from '@nestjs/common';
import type { RecordDefaults } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/** SC-H10：透過真實 HTTP 與資料庫確認預設值和成員隔離。 */
describe('Every entry has an account — record defaults (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const date = new Date('2026-10-14T12:00:00.000Z');

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const defaults = async (who: Person, ledgerId?: string): Promise<RecordDefaults> => {
    const call = request(httpServer(app)).get('/api/users/me/record-defaults').set(auth(who.token));
    const response = await (ledgerId ? call.query({ ledgerId }) : call).expect(200);
    return response.body as RecordDefaults;
  };

  const record = async (
    who: Person,
    ledgerId = who.ledgerId,
    accountId: string | null = who.cashId,
    createdAt = date,
  ) =>
    prisma.transaction.create({
      data: {
        ledgerId,
        creatorId: who.userId,
        accountId,
        type: 'EXPENSE',
        amount: 100,
        date,
        createdAt,
      },
    });

  it('從未記帳、未帶帳本與已指定帳本都回正確空值', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    expect(await defaults(alice)).toEqual({ ledgerId: null, accountId: null });
    expect(await defaults(alice, alice.ledgerId)).toEqual({
      ledgerId: alice.ledgerId,
      accountId: null,
    });
  });

  it('最近一筆必須是自己建立、未刪除且使用自己的正式帳戶', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const temporary = await prisma.account.findFirstOrThrow({
      where: { userId: alice.userId, isTemporary: true },
    });
    const old = new Date(date.getTime() - 60_000);
    await record(alice, alice.ledgerId, alice.cashId, old);
    await record(alice, alice.ledgerId, null, new Date(date.getTime() + 1_000));
    await record(alice, alice.ledgerId, temporary.id, new Date(date.getTime() + 2_000));
    await record(alice, alice.ledgerId, bob.cashId, new Date(date.getTime() + 3_000));
    const deleted = await record(
      alice,
      alice.ledgerId,
      alice.cashId,
      new Date(date.getTime() + 4_000),
    );
    await prisma.transaction.update({ where: { id: deleted.id }, data: { deletedAt: date } });
    await record(bob, bob.ledgerId, bob.cashId, new Date(date.getTime() + 5_000));
    expect(await defaults(alice)).toEqual({ ledgerId: alice.ledgerId, accountId: alice.cashId });
  });

  it('封存或退出後只帶帳戶；VIEWER 沒有寫入權', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const sharedId = await createSharedLedger(app, alice.token);
    await prisma.ledgerMember.create({
      data: { ledgerId: sharedId, userId: bob.userId, role: 'VIEWER' },
    });
    await record(bob, sharedId);
    expect(await defaults(bob)).toEqual({ ledgerId: null, accountId: bob.cashId });
    await prisma.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId: sharedId, userId: bob.userId } },
      data: { role: 'EDITOR' },
    });
    expect(await defaults(bob)).toEqual({ ledgerId: sharedId, accountId: bob.cashId });
    await prisma.ledger.update({ where: { id: sharedId }, data: { archivedAt: date } });
    expect(await defaults(bob)).toEqual({ ledgerId: null, accountId: bob.cashId });
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: sharedId, userId: bob.userId } },
    });
    expect(await defaults(bob)).toEqual({ ledgerId: null, accountId: bob.cashId });
    await request(httpServer(app))
      .get('/api/users/me/record-defaults')
      .query({ ledgerId: sharedId })
      .set(auth(bob.token))
      .expect(404);
  });

  it('指定帳本優先用該帳本帳戶；沒用過才回退整體最近一次', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const sharedId = await createSharedLedger(app, alice.token);
    const unusedId = await createSharedLedger(app, alice.token, 'Unused');
    const second = await prisma.account.create({ data: { userId: alice.userId, name: '銀行' } });
    await record(alice, sharedId, alice.cashId, new Date(date.getTime() - 1_000));
    await record(alice, alice.ledgerId, second.id, date);
    expect(await defaults(alice, sharedId)).toEqual({
      ledgerId: sharedId,
      accountId: alice.cashId,
    });
    expect(await defaults(alice, unusedId)).toEqual({ ledgerId: unusedId, accountId: second.id });
    expect(await defaults(alice)).toEqual({ ledgerId: alice.ledgerId, accountId: second.id });
    await request(httpServer(app))
      .get('/api/users/me/record-defaults')
      .query({ ledgerId: sharedId })
      .set(auth(bob.token))
      .expect(404);
    await request(httpServer(app))
      .get('/api/users/me/record-defaults')
      .query({ ledgerId: 'bad-id' })
      .set(auth(alice.token))
      .expect(400);
  });

  it('1 萬筆混合交易量測五次 HTTP 回應時間', async () => {
    const alice = await person(app, 'alice@example.com', 'Alice');
    const sharedId = await createSharedLedger(app, alice.token);
    const second = await prisma.account.create({ data: { userId: alice.userId, name: '銀行' } });
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      ledgerId: index % 2 === 0 ? alice.ledgerId : sharedId,
      creatorId: alice.userId,
      accountId: index % 3 === 0 ? alice.cashId : second.id,
      type: 'EXPENSE' as const,
      amount: 100,
      date,
      createdAt: new Date(date.getTime() + index),
    }));
    for (let offset = 0; offset < rows.length; offset += 1_000) {
      await prisma.transaction.createMany({ data: rows.slice(offset, offset + 1_000) });
    }
    const samples: number[] = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      await request(httpServer(app))
        .get('/api/users/me/record-defaults')
        .set(auth(alice.token))
        .expect(200);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `record-defaults 10k HTTP samples (ms): ${samples.map((ms) => ms.toFixed(1)).join(', ')}; median ${samples[2]!.toFixed(1)} ms`,
    );
  }, 60_000);
});
