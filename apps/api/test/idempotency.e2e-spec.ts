import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  IDEMPOTENCY_KEY_HEADER,
  type CreateDebtEntryResponse,
  type Split,
  type Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoriesService } from '../src/categories/categories.service';
import { corsOptions } from '../src/config/cors-options';
import type { Env } from '../src/config/env.validation';
import { DebtEntriesService } from '../src/debts/debt-entries.service';
import { IdempotencyService, requestHash } from '../src/idempotency/idempotency.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SplitsService } from '../src/splits/splits.service';
import {
  createE2EApp,
  createSharedLedger,
  httpServer,
  idempotencyKey,
  listAccounts,
  resetDb,
} from './e2e-utils';
import {
  auth,
  createCounterparty,
  DAY,
  getCounterparty,
  linkPair,
  person,
  type Person,
} from './linking-utils';

type Kind = 'transaction' | 'debt' | 'split' | 'settlement' | 'forgive';
const kinds: Kind[] = ['transaction', 'debt', 'split', 'settlement', 'forgive'];
interface Fixture {
  who: Person;
  path: string;
  body: Record<string, unknown>;
  counterpartyId: string;
  ledgerId: string;
  cashBefore: number;
  idOf: (body: unknown) => string;
  remove: (body: unknown) => Promise<void>;
  assertOnce: () => Promise<void>;
}

/** 真的 HTTP 與資料庫驗證 SC-IK1～11；每次重送都比對筆數與金額效果。 */
describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());
  const server = () => httpServer(app);
  async function cash(who: Person) {
    return (await listAccounts(app, who.token)).find((account) => account.id === who.cashId)!
      .balance;
  }
  /** 包含軟刪除的總筆數與生效金額，避免只比對回應而漏掉帳務副作用。 */
  async function effects() {
    return {
      keys: await prisma.idempotencyKey.count(),
      transactions: await prisma.transaction.count(),
      activeTransactions: await prisma.transaction.aggregate({
        where: { deletedAt: null },
        _count: true,
        _sum: { amount: true },
      }),
      debtEntries: await prisma.debtEntry.count(),
      activeDebtEntries: await prisma.debtEntry.aggregate({
        where: { deletedAt: null },
        _count: true,
        _sum: { delta: true },
      }),
      splits: await prisma.split.count(),
      splitShares: await prisma.splitParticipant.aggregate({ _count: true, _sum: { share: true } }),
      ledgerShares: await prisma.ledgerShare.aggregate({ _count: true, _sum: { share: true } }),
      settlements: await prisma.ledgerSettlement.count(),
      differences: await prisma.transaction.count({ where: { differenceOfId: { not: null } } }),
      proposals: await prisma.debtProposal.count(),
    };
  }
  function send(f: Fixture, key?: Record<string, string | string[]>, body = f.body) {
    const call = request(server()).post(f.path).set(auth(f.who.token));
    if (key) call.set(key);
    return call.send(body);
  }
  async function deletePath(who: Person, path: string) {
    await request(server()).delete(path).set(auth(who.token)).expect(204);
  }
  async function lend(who: Person, counterpartyId: string, amount = 5000) {
    return request(server())
      .post('/api/debt-entries')
      .set(auth(who.token))
      .set(idempotencyKey())
      .send({
        counterparty: { id: counterpartyId },
        kind: 'LEND',
        amount,
        date: DAY,
        record: { ledgerId: who.ledgerId, accountId: who.cashId },
      })
      .expect(201);
  }
  async function fixture(kind: Kind): Promise<Fixture> {
    const who = await person(app, 'alice@example.com', 'Alice');
    let ledgerId = who.ledgerId;
    const counterparty = await createCounterparty(app, who, '小明');
    let toPersonId: string | undefined;
    if (kind === 'settlement') {
      const bob = await person(app, 'bob@example.com', 'Bob');
      ledgerId = await createSharedLedger(app, who.token, '家用');
      await request(server())
        .post(`/api/ledgers/${ledgerId}/members`)
        .set(auth(who.token))
        .send({ email: bob.email, role: 'EDITOR' })
        .expect(201);
      toPersonId = (
        await prisma.ledgerPerson.findUniqueOrThrow({
          where: { ledgerId_userId: { ledgerId, userId: bob.userId } },
        })
      ).id;
    }
    const categoryId = (
      await prisma.category.findFirstOrThrow({ where: { ledgerId, type: 'EXPENSE' } })
    ).id;
    if (kind === 'forgive') await lend(who, counterparty.id);
    const cashBefore = await cash(who);
    const path =
      kind === 'transaction'
        ? `/api/ledgers/${ledgerId}/transactions`
        : kind === 'debt'
          ? '/api/debt-entries'
          : kind === 'split'
            ? '/api/splits'
            : kind === 'settlement'
              ? `/api/ledgers/${ledgerId}/settlements`
              : `/api/counterparties/${counterparty.id}/forgive`;
    const body: Record<string, unknown> =
      kind === 'transaction'
        ? { type: 'EXPENSE', amount: 12300, date: DAY, categoryId, accountId: who.cashId }
        : kind === 'debt'
          ? {
              counterparty: { id: counterparty.id },
              kind: 'LEND',
              amount: 5000,
              date: DAY,
              record: { ledgerId, accountId: who.cashId },
            }
          : kind === 'split'
            ? {
                type: 'EXPENSE',
                ledgerId,
                categoryId,
                total: 30000,
                date: DAY,
                payer: null,
                accountId: who.cashId,
                method: 'EQUAL',
                participants: [{ counterpartyId: null }, { counterpartyId: counterparty.id }],
              }
            : kind === 'settlement'
              ? { toPersonId, amount: 20000, date: DAY, fromAccountId: who.cashId }
              : { ledgerId };
    const idOf = (value: unknown): string =>
      kind === 'debt' || kind === 'forgive'
        ? (value as CreateDebtEntryResponse).entries[0]!.id
        : (value as Transaction | Split).id;
    return {
      who,
      path,
      body,
      counterpartyId: counterparty.id,
      ledgerId,
      cashBefore,
      idOf,
      remove: (value) =>
        deletePath(
          who,
          kind === 'transaction'
            ? `/api/ledgers/${ledgerId}/transactions/${idOf(value)}`
            : kind === 'settlement'
              ? `/api/ledgers/${ledgerId}/settlements/${(value as Transaction).settlement!.id}`
              : kind === 'split'
                ? `/api/splits/${idOf(value)}`
                : `/api/debt-entries/${idOf(value)}`,
        ),
      assertOnce: async () => {
        expect(await cash(who)).toBe(
          cashBefore -
            { transaction: 12300, debt: 5000, split: 30000, settlement: 20000, forgive: 0 }[kind],
        );
        const key = await prisma.idempotencyKey.findFirstOrThrow({
          where: {
            operation: (
              {
                transaction: 'TRANSACTION_CREATE',
                debt: 'DEBT_ENTRY_CREATE',
                split: 'SPLIT_CREATE',
                settlement: 'SETTLEMENT_CREATE',
                forgive: 'COUNTERPARTY_FORGIVE',
              } as const
            )[kind],
          },
        });
        expect(key.resultId).toEqual(expect.any(String));
        if (kind === 'transaction' || kind === 'settlement') {
          expect(await prisma.transaction.count({ where: { ledgerId, deletedAt: null } })).toBe(1);
          expect(
            (await prisma.transaction.findUniqueOrThrow({ where: { id: key.resultId! } })).amount,
          ).toBe(kind === 'transaction' ? 12300 : 20000);
        }
        if (kind === 'debt' || kind === 'forgive') {
          expect(
            await prisma.debtEntry.count({
              where: {
                counterpartyId: counterparty.id,
                kind: kind === 'debt' ? 'LEND' : 'FORGIVE',
              },
            }),
          ).toBe(1);
          expect((await getCounterparty(app, who, counterparty.id)).balance).toBe(
            kind === 'debt' ? 5000 : 0,
          );
        }
        if (kind === 'split') {
          expect(await prisma.split.count()).toBe(1);
          expect(await prisma.splitParticipant.count()).toBe(2);
          expect((await getCounterparty(app, who, counterparty.id)).balance).toBe(15000);
          expect(
            (await prisma.splitParticipant.aggregate({ _sum: { share: true } }))._sum.share,
          ).toBe(30000);
        }
        if (kind === 'settlement') expect(await prisma.ledgerSettlement.count()).toBe(1);
      },
    };
  }

  describe.each(kinds)('%s', (kind) => {
    it('SC-IK9 checks write access to the resource current ledger on replay', async () => {
      const f = await fixture(kind);
      const key = idempotencyKey();
      const first = await send(f, key).expect(201);
      const other = await person(app, 'charlie@example.com', 'Charlie');
      const id = f.idOf(first.body);
      // 用資料庫模擬已搬帳本的結果；重送的路徑仍指向原本可存取的帳本。
      if (kind === 'split') {
        await prisma.split.update({ where: { id }, data: { ledgerId: other.ledgerId } });
      } else {
        const transactionId =
          kind === 'debt' || kind === 'forgive'
            ? (await prisma.debtEntry.findUniqueOrThrow({ where: { id } })).transactionId!
            : id;
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { ledgerId: other.ledgerId },
        });
      }
      const before = await effects();
      const cashBefore = await cash(f.who);
      const replay = await send(f, key).expect(404);
      expect(JSON.stringify(replay.body)).not.toContain(id);
      expect(await effects()).toEqual(before);
      expect(await cash(f.who)).toBe(cashBefore);
    });
    it.each(['missing', 'empty', 'invalid', 'duplicate'])(
      'SC-IK1 rejects %s headers before writing',
      async (invalid) => {
        const f = await fixture(kind);
        const before = await effects();
        const header =
          invalid === 'missing'
            ? undefined
            : {
                [IDEMPOTENCY_KEY_HEADER]:
                  invalid === 'empty'
                    ? ''
                    : invalid === 'invalid'
                      ? 'not-a-uuid'
                      : [
                          idempotencyKey()[IDEMPOTENCY_KEY_HEADER],
                          idempotencyKey()[IDEMPOTENCY_KEY_HEADER],
                        ],
              };
        const res = await send(f, header).expect(400);
        expect(res.body).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_INVALID' });
        expect(await effects()).toEqual(before);
        expect(await cash(f.who)).toBe(f.cashBefore);
      },
    );
    it('SC-IK1 validates the DTO before the header', async () => {
      const f = await fixture(kind);
      const before = await effects();
      const res = await send(f, undefined, { unexpected: true }).expect(400);
      expect(res.body).toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(await effects()).toEqual(before);
      expect(await cash(f.who)).toBe(f.cashBefore);
    });
    it('SC-IK1/2 accepts uppercase, stores lowercase, and sequentially replays once', async () => {
      const f = await fixture(kind);
      const original = idempotencyKey()[IDEMPOTENCY_KEY_HEADER];
      const first = await send(f, { [IDEMPOTENCY_KEY_HEADER]: original.toUpperCase() }).expect(201);
      const afterFirst = await effects();
      const second = await send(f, { [IDEMPOTENCY_KEY_HEADER]: original }).expect(201);
      expect(f.idOf(second.body)).toBe(f.idOf(first.body));
      expect(
        await prisma.idempotencyKey.count({ where: { userId: f.who.userId, key: original } }),
      ).toBe(1);
      expect(await effects()).toEqual(afterFirst);
      await f.assertOnce();
    });
    it('SC-IK6 rejects replay of a deleted resource without restoring it', async () => {
      const f = await fixture(kind);
      const key = idempotencyKey();
      const first = await send(f, key).expect(201);
      await f.remove(first.body);
      const deleted = await effects();
      const cashAfterDelete = await cash(f.who);
      const second = await send(f, key).expect(409);
      expect(second.body).toMatchObject({ errorCode: 'IDEMPOTENCY_RESOURCE_DELETED' });
      expect(await effects()).toEqual(deleted);
      expect(await cash(f.who)).toBe(cashAfterDelete);
      const id = f.idOf(first.body);
      const row =
        kind === 'debt' || kind === 'forgive'
          ? await prisma.debtEntry.findUniqueOrThrow({ where: { id } })
          : kind === 'split'
            ? await prisma.split.findUniqueOrThrow({ where: { id } })
            : await prisma.transaction.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).not.toBeNull();
    });
  });

  it('SC-IK4 rejects a changed amount, operation, ledger, or counterparty without exposing results', async () => {
    const f = await fixture('transaction');
    const key = idempotencyKey();
    const first = await send(f, key).expect(201);
    const secondLedgerId = await createSharedLedger(app, f.who.token, '其他');
    const before = await effects();
    const calls = [
      () => send(f, key, { ...f.body, amount: 12301 }),
      () =>
        request(server())
          .post('/api/debt-entries')
          .set(auth(f.who.token))
          .set(key)
          .send({
            counterparty: { id: f.counterpartyId },
            kind: 'LEND',
            amount: 12300,
            date: DAY,
            record: { ledgerId: f.ledgerId, accountId: f.who.cashId },
          }),
      () =>
        request(server())
          .post(`/api/ledgers/${secondLedgerId}/transactions`)
          .set(auth(f.who.token))
          .set(key)
          .send(f.body),
    ];
    for (const call of calls) {
      const res = await call().expect(409);
      expect(res.body).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
      expect(JSON.stringify(res.body)).not.toContain(f.idOf(first.body));
      expect(await effects()).toEqual(before);
      await f.assertOnce();
    }
    const forgiveKey = idempotencyKey();
    await lend(f.who, f.counterpartyId);
    await request(server())
      .post(`/api/counterparties/${f.counterpartyId}/forgive`)
      .set(auth(f.who.token))
      .set(forgiveKey)
      .send({ ledgerId: f.ledgerId })
      .expect(201);
    const another = await createCounterparty(app, f.who, '另一位');
    const beforeConflict = await effects();
    const cashBefore = await cash(f.who);
    const res = await request(server())
      .post(`/api/counterparties/${another.id}/forgive`)
      .set(auth(f.who.token))
      .set(forgiveKey)
      .send({ ledgerId: f.ledgerId })
      .expect(409);
    expect(res.body).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await effects()).toEqual(beforeConflict);
    expect(await cash(f.who)).toBe(cashBefore);
  });
  it('SC-IK5 records identical consumption twice when the keys differ', async () => {
    const f = await fixture('transaction');
    const first = await send(f, idempotencyKey()).expect(201);
    const second = await send(f, idempotencyKey()).expect(201);
    expect(f.idOf(second.body)).not.toBe(f.idOf(first.body));
    expect(await prisma.idempotencyKey.count()).toBe(2);
    expect(await prisma.transaction.count()).toBe(2);
    expect(await cash(f.who)).toBe(f.cashBefore - 24600);
  });
  it('SC-IK6 returns 404 for a physically deleted resource and retains its key', async () => {
    const f = await fixture('transaction');
    const key = idempotencyKey();
    const first = await send(f, key).expect(201);
    await prisma.transaction.delete({ where: { id: f.idOf(first.body) } });
    const before = await effects();
    const cashBefore = await cash(f.who);
    await send(f, key).expect(404);
    expect(await effects()).toEqual(before);
    expect(await prisma.idempotencyKey.count()).toBe(1);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await cash(f.who)).toBe(cashBefore);
  });
  it('SC-IK7 rolls back real writes when the callback returns an empty result id', async () => {
    const f = await fixture('transaction');
    const key = idempotencyKey();
    const before = await effects();
    await expect(
      app.get(IdempotencyService).run(
        {
          userId: f.who.userId,
          key: key[IDEMPOTENCY_KEY_HEADER],
          operation: 'TRANSACTION_CREATE',
          scopeId: f.ledgerId,
          requestHash: requestHash(f.body),
        },
        async (tx) => {
          await tx.transaction.create({
            data: {
              ledgerId: f.ledgerId,
              creatorId: f.who.userId,
              accountId: f.who.cashId,
              categoryId: f.body.categoryId as string,
              type: 'EXPENSE',
              amount: 12300,
              date: new Date(DAY),
            },
          });
          return '';
        },
        () => Promise.resolve(null),
      ),
    ).rejects.toThrow('did not return a result id');
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK7 rolls back a business error and accepts the same key after conditions change', async () => {
    const f = await fixture('debt');
    const key = idempotencyKey();
    const body = { ...f.body, kind: 'REPAYMENT' };
    const before = await effects();
    const rejected = await send(f, key, body).expect(409);
    expect(rejected.body).toMatchObject({ errorCode: 'NOTHING_TO_REPAY' });
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
    await lend(f.who, f.counterpartyId);
    await send(f, key, body).expect(201);
    expect(await prisma.idempotencyKey.count({ where: { key: key[IDEMPOTENCY_KEY_HEADER] } })).toBe(
      1,
    );
    expect(await prisma.debtEntry.count()).toBe(2);
    expect(await prisma.transaction.count()).toBe(2);
    expect((await getCounterparty(app, f.who, f.counterpartyId)).balance).toBe(0);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK7 rolls back split transactions, shares, entries, and proposals after an injected error', async () => {
    const f = await fixture('split');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const linked = await linkPair(app, f.who, bob, null, null);
    f.body.participants = [{ counterpartyId: null }, { counterpartyId: linked.aCounterpartyId }];
    const service = app.get<SplitsService>(SplitsService) as unknown as {
      writeComposition: (...args: unknown[]) => Promise<void>;
    };
    const original = service.writeComposition.bind(service);
    const before = await effects();
    let staged: { transactions: number; shares: number; proposals: number } | undefined;
    jest.spyOn(service, 'writeComposition').mockImplementationOnce(async (...args) => {
      await original(...args);
      const tx = args[0] as PrismaService;
      staged = {
        transactions: await tx.transaction.count(),
        shares: await tx.splitParticipant.count(),
        proposals: await tx.debtProposal.count(),
      };
      throw new Error('Injected failure after split composition');
    });
    await send(f, idempotencyKey()).expect(500);
    expect(staged).toMatchObject({ shares: 2, proposals: 1 });
    expect(staged?.transactions).toBeGreaterThan(0);
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK7 rolls back repayment difference and proposals after writing', async () => {
    const f = await fixture('debt');
    const bob = await person(app, 'bob@example.com', 'Bob');
    const linked = await linkPair(app, f.who, bob, null, null);
    await lend(f.who, linked.aCounterpartyId);
    const service = app.get<DebtEntriesService>(DebtEntriesService) as unknown as {
      differenceOf: (...args: unknown[]) => Promise<unknown>;
    };
    const original = service.differenceOf.bind(service);
    const before = await effects();
    const cashBefore = await cash(f.who);
    let staged: { differences: number; proposals: number } | undefined;
    jest.spyOn(service, 'differenceOf').mockImplementationOnce(async (...args) => {
      await original(...args);
      const tx = args[0] as PrismaService;
      staged = {
        differences: await tx.transaction.count({ where: { differenceOfId: { not: null } } }),
        proposals: await tx.debtProposal.count(),
      };
      throw new Error('Injected failure after repayment difference');
    });
    await send(f, idempotencyKey(), {
      ...f.body,
      counterparty: { id: linked.aCounterpartyId },
      kind: 'REPAYMENT',
      settle: true,
      amount: 4000,
    }).expect(500);
    expect(staged).toEqual({ differences: 1, proposals: 2 });
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(cashBefore);
    expect((await getCounterparty(app, f.who, linked.aCounterpartyId)).balance).toBe(5000);
  });
  it('SC-IK7 rolls back a newly created AI category', async () => {
    const f = await fixture('transaction');
    const service = app.get(CategoriesService);
    const original = service.findOrCreateByName.bind(service);
    let stagedCategories = 0;
    jest.spyOn(service, 'findOrCreateByName').mockImplementationOnce(async (...args) => {
      await original(...args);
      stagedCategories = await args[0].category.count({ where: { name: 'AI 新分類' } });
      throw new Error('Injected failure after AI category creation');
    });
    const before = await effects();
    const body = { ...f.body, categoryId: undefined, newCategoryName: 'AI 新分類' };
    await send(f, idempotencyKey(), body).expect(500);
    expect(stagedCategories).toBe(1);
    expect(await effects()).toEqual(before);
    expect(await prisma.category.count({ where: { name: 'AI 新分類' } })).toBe(0);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK8 replays a committed resource after response reconstruction fails', async () => {
    const f = await fixture('split');
    const key = idempotencyKey();
    jest
      .spyOn(app.get(SplitsService), 'get')
      .mockRejectedValueOnce(new Error('Injected response failure'));
    await send(f, key).expect(500);
    const row = await prisma.idempotencyKey.findUniqueOrThrow({
      where: { userId_key: { userId: f.who.userId, key: key[IDEMPOTENCY_KEY_HEADER] } },
    });
    const committed = await effects();
    await f.assertOnce();
    const replay = await send(f, key).expect(201);
    expect(f.idOf(replay.body)).toBe(row.resultId);
    expect(await effects()).toEqual(committed);
    await f.assertOnce();
  });
  it('SC-IK10 does not forgive new debt when an earlier forgiveness is replayed', async () => {
    const f = await fixture('forgive');
    const key = idempotencyKey();
    const first = await send(f, key).expect(201);
    await lend(f.who, f.counterpartyId, 2300);
    const before = await effects();
    const cashBefore = await cash(f.who);
    const second = await send(f, key).expect(201);
    expect(f.idOf(second.body)).toBe(f.idOf(first.body));
    expect(await effects()).toEqual(before);
    expect(await prisma.debtEntry.count({ where: { kind: 'FORGIVE' } })).toBe(1);
    expect((await getCounterparty(app, f.who, f.counterpartyId)).balance).toBe(2300);
    expect(await cash(f.who)).toBe(cashBefore);
  });
  it('SC-IK11 documents required headers and all three error codes on the five operations', async () => {
    const f = await fixture('transaction');
    const before = await effects();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    for (const path of [
      '/api/ledgers/{ledgerId}/transactions',
      '/api/debt-entries',
      '/api/splits',
      '/api/ledgers/{ledgerId}/settlements',
      '/api/counterparties/{id}/forgive',
    ]) {
      const operation = document.paths[path]!.post!;
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({ in: 'header', name: IDEMPOTENCY_KEY_HEADER, required: true }),
      );
      expect(JSON.stringify(operation.responses['400'])).toContain('IDEMPOTENCY_KEY_INVALID');
      for (const code of ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_RESOURCE_DELETED'])
        expect(JSON.stringify(operation.responses['409'])).toContain(code);
    }
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK11 permits Idempotency-Key in a CORS preflight with the production options', async () => {
    const f = await fixture('transaction');
    const before = await effects();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const corsApp = moduleRef.createNestApplication();
    const config = corsApp.get(ConfigService<Env, true>);
    corsApp.enableCors(corsOptions(config));
    await corsApp.init();
    try {
      const origin = config.get('CORS_ORIGIN', { infer: true })[0]!;
      const res = await request(httpServer(corsApp))
        .options(f.path)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-headers']).toContain('idempotency-key');
    } finally {
      await corsApp.close();
    }
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('SC-IK11 leaves category and account creation without a header unchanged', async () => {
    const f = await fixture('transaction');
    const before = await effects();
    const categoriesBefore = await prisma.category.count();
    const accountsBefore = await prisma.account.count();
    await request(server())
      .post(`/api/ledgers/${f.ledgerId}/categories`)
      .set(auth(f.who.token))
      .send({ name: '額外分類', type: 'EXPENSE' })
      .expect(201);
    await request(server())
      .post('/api/accounts')
      .set(auth(f.who.token))
      .send({ name: '額外帳戶', initialBalance: 0 })
      .expect(201);
    expect(await prisma.category.count()).toBe(categoriesBefore + 1);
    expect(await prisma.account.count()).toBe(accountsBefore + 1);
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore);
  });
  it('measures Prisma 7.8 P2002 metadata and proves resetDb clears the new table', async () => {
    const f = await fixture('transaction');
    const key = idempotencyKey();
    await send(f, key).expect(201);
    const data = {
      userId: f.who.userId,
      key: key[IDEMPOTENCY_KEY_HEADER],
      operation: 'TRANSACTION_CREATE' as const,
      requestHash: 'v1:probe',
      resultType: 'TRANSACTION' as const,
      resultId: 'probe',
    };
    const before = await effects();
    await expect(
      prisma.$transaction((tx) => tx.idempotencyKey.create({ data })),
    ).rejects.toMatchObject({
      code: 'P2002',
      meta: {
        modelName: 'IdempotencyKey',
        driverAdapterError: {
          cause: {
            originalCode: '23505',
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['"userId"', 'key'] },
          },
        },
      },
    });
    expect(await effects()).toEqual(before);
    expect(await cash(f.who)).toBe(f.cashBefore - 12300);
    await resetDb(prisma);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    expect((await prisma.transaction.aggregate({ _sum: { amount: true } }))._sum.amount).toBeNull();
  });
});
