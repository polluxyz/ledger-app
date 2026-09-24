import { INestApplication } from '@nestjs/common';
import type {
  Account,
  Counterparty,
  CreateDebtEntryResponse,
  DebtEntry,
  Paginated,
  Transaction,
} from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2EApp,
  firstAccountId,
  firstLedgerId,
  httpServer,
  registerAndLogin,
  resetDb,
} from './e2e-utils';

/**
 * 往來帳（3b-1 往來帳版）的端對端流程：借與還互相抵銷、餘額翻轉、以此結清、代付、免除、
 * 改與刪、交易端點的唯讀、帳本不能真刪、對象的改名與刪除。對應 spec SC-L1～L10、L13～L15。
 *
 * 每個測試用註冊時自動建立的個人帳本（連動帳本）與預設的「現金」帳戶。帳戶餘額一律從
 * `GET /accounts` 讀出來比對，驗的是使用者實際看到的數字。
 */
describe('Debt ledger (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const DAY = '2026-09-24T12:00:00.000Z';

  interface Me {
    token: string;
    ledgerId: string;
    cashId: string;
  }

  async function me(): Promise<Me> {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    return {
      token: alice.token,
      ledgerId: await firstLedgerId(app, alice.token),
      cashId: await firstAccountId(app, alice.token),
    };
  }

  async function cash(user: Me): Promise<number> {
    const res = await request(server()).get('/api/accounts').set(auth(user.token));
    return (res.body as Account[]).find((account) => account.id === user.cashId)!.balance;
  }

  async function ledgerTransactions(user: Me): Promise<Transaction[]> {
    const res = await request(server())
      .get(`/api/ledgers/${user.ledgerId}/transactions`)
      .set(auth(user.token))
      .expect(200);
    return (res.body as Paginated<Transaction>).items;
  }

  async function expenseCategoryId(user: Me): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${user.ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(user.token))
      .expect(200);
    return (res.body as Array<{ id: string }>)[0]!.id;
  }

  function post(user: Me, body: Record<string, unknown>) {
    return request(server()).post('/api/debt-entries').set(auth(user.token)).send(body);
  }

  /** 用名字記一筆，記進現金（`record` 可覆寫）。 */
  async function entry(
    user: Me,
    kind: string,
    amount: number,
    extra: Record<string, unknown> = {},
  ): Promise<CreateDebtEntryResponse> {
    const res = await post(user, {
      counterparty: { name: '小明' },
      kind,
      amount,
      date: DAY,
      record: { ledgerId: user.ledgerId, accountId: user.cashId },
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body as CreateDebtEntryResponse;
  }

  async function counterparties(user: Me): Promise<Counterparty[]> {
    const res = await request(server())
      .get('/api/counterparties')
      .set(auth(user.token))
      .expect(200);
    return (res.body as Paginated<Counterparty>).items;
  }

  async function entriesOf(user: Me, counterpartyId: string): Promise<DebtEntry[]> {
    const res = await request(server())
      .get(`/api/counterparties/${counterpartyId}/entries`)
      .set(auth(user.token))
      .expect(200);
    return (res.body as Paginated<DebtEntry>).items;
  }

  function errorCode(res: request.Response): string {
    return (res.body as { errorCode: string }).errorCode;
  }

  // SC-L1
  it('offsets lending and borrowing with the same person into one balance', async () => {
    const user = await me();
    const before = await cash(user);

    await entry(user, 'LEND', 120);
    const second = await entry(user, 'BORROW', 111);

    expect(second.counterparty.balance).toBe(9);
    expect(await cash(user)).toBe(before - 9);
    const types = (await ledgerTransactions(user)).map((txn) => [txn.type, txn.amount]);
    expect(types).toEqual(
      expect.arrayContaining([
        ['LEND', 120],
        ['BORROW', 111],
      ]),
    );
    // SC-L15：擁有者看得到對象名字。
    for (const txn of await ledgerTransactions(user)) {
      expect(txn.debt).toMatchObject({ counterpartyName: '小明' });
      expect(txn.category).toBeNull();
    }
  });

  // SC-L2
  it('treats names that differ only by surrounding spaces as one counterparty', async () => {
    const user = await me();
    await entry(user, 'LEND', 10, { counterparty: { name: ' 小明 ' } });
    await entry(user, 'LEND', 20, { counterparty: { name: '小明' } });

    const list = await counterparties(user);
    expect(list).toEqual([expect.objectContaining({ name: '小明', balance: 30 })]);
  });

  // SC-L3
  it('lets the balance flip sign without an error', async () => {
    const user = await me();
    await entry(user, 'LEND', 9);
    const res = await entry(user, 'COLLECT', 20);
    expect(res.counterparty.balance).toBe(-11);
  });

  // SC-L4
  describe('settle', () => {
    it('adds a negative SETTLEMENT when the repayment falls short', async () => {
      const user = await me();
      await entry(user, 'LEND', 93);
      const before = await cash(user);

      const res = await entry(user, 'COLLECT', 90, { settle: true });

      expect(res.entries.map((e) => [e.kind, e.delta])).toEqual([
        ['COLLECT', -90],
        ['SETTLEMENT', -3],
      ]);
      expect(res.counterparty.balance).toBe(0);
      expect(await cash(user)).toBe(before + 90);
      expect((await ledgerTransactions(user)).filter((t) => t.type === 'COLLECT')).toHaveLength(1);
    });

    it('adds a positive SETTLEMENT when they pay more', async () => {
      const user = await me();
      await entry(user, 'LEND', 93);
      const res = await entry(user, 'COLLECT', 95, { settle: true });
      expect(res.entries[1]).toMatchObject({ kind: 'SETTLEMENT', delta: 2 });
    });

    it('rejects settle on a non-repayment kind', async () => {
      const user = await me();
      const res = await post(user, {
        counterparty: { name: '小明' },
        kind: 'LEND',
        amount: 1,
        date: DAY,
        record: null,
        settle: true,
      });
      expect(res.status).toBe(400);
    });
  });

  // SC-L5
  describe('paid for me', () => {
    it('records my share as an expense that does not touch my accounts', async () => {
      const user = await me();
      const before = await cash(user);
      const categoryId = await expenseCategoryId(user);

      const res = await entry(user, 'PAID_FOR_ME', 400, {
        record: { ledgerId: user.ledgerId },
        categoryId,
      });

      expect(res.counterparty.balance).toBe(-400);
      expect(await cash(user)).toBe(before);
      const [expense] = await ledgerTransactions(user);
      expect(expense).toMatchObject({
        type: 'EXPENSE',
        amount: 400,
        account: null,
        category: { id: categoryId },
        debt: { counterpartyName: '小明' },
      });
    });

    it.each([
      ['without a category', { record: { ledgerId: 'LEDGER' } }],
      ['with an account', { record: { ledgerId: 'LEDGER', accountId: 'CASH' }, categoryId: 'CAT' }],
      ['with record null', { record: null, categoryId: 'CAT' }],
    ])('is rejected %s', async (_label, extra) => {
      const user = await me();
      const categoryId = await expenseCategoryId(user);
      const body = JSON.parse(
        JSON.stringify(extra)
          .replace('LEDGER', user.ledgerId)
          .replace('CASH', user.cashId)
          .replace('CAT', categoryId),
      ) as Record<string, unknown>;

      const res = await post(user, {
        counterparty: { name: '小明' },
        kind: 'PAID_FOR_ME',
        amount: 400,
        date: DAY,
        ...body,
      });
      expect(res.status).toBe(400);
      expect(await prisma.debtEntry.count()).toBe(0);
    });
  });

  // SC-L6
  it('forgives what they owe, and deleting the forgiveness restores it', async () => {
    const user = await me();
    const { counterparty } = await entry(user, 'LEND', 50, { record: null });

    const forgiven = await request(server())
      .post(`/api/counterparties/${counterparty.id}/forgive`)
      .set(auth(user.token))
      .expect(201);
    const body = forgiven.body as CreateDebtEntryResponse;
    expect(body.entries[0]).toMatchObject({ kind: 'FORGIVE', delta: -50, transactionId: null });
    expect(body.counterparty.balance).toBe(0);

    const again = await request(server())
      .post(`/api/counterparties/${counterparty.id}/forgive`)
      .set(auth(user.token));
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('NOTHING_TO_FORGIVE');

    await request(server())
      .delete(`/api/debt-entries/${body.entries[0]!.id}`)
      .set(auth(user.token))
      .expect(204);
    expect((await counterparties(user))[0]!.balance).toBe(50);
  });

  // SC-L7
  it('moves the transaction with an edited amount, and refuses to edit adjustments', async () => {
    const user = await me();
    const before = await cash(user);
    const lend = await entry(user, 'LEND', 120);

    const edited = await request(server())
      .patch(`/api/debt-entries/${lend.entries[0]!.id}`)
      .set(auth(user.token))
      .send({ amount: 150 })
      .expect(200);
    expect((edited.body as DebtEntry).delta).toBe(150);
    expect(await cash(user)).toBe(before - 150);

    const settled = await entry(user, 'COLLECT', 140, { settle: true });
    const adjustment = await request(server())
      .patch(`/api/debt-entries/${settled.entries[1]!.id}`)
      .set(auth(user.token))
      .send({ note: 'x' });
    expect(adjustment.status).toBe(409);
    expect(errorCode(adjustment)).toBe('DEBT_ENTRY_NOT_EDITABLE');
  });

  // SC-L8
  it('soft-deletes an entry with its transaction and restores both balances', async () => {
    const user = await me();
    const before = await cash(user);
    const lend = await entry(user, 'LEND', 120);

    await request(server())
      .delete(`/api/debt-entries/${lend.entries[0]!.id}`)
      .set(auth(user.token))
      .expect(204);

    expect(await cash(user)).toBe(before);
    expect(await ledgerTransactions(user)).toHaveLength(0);
    expect((await counterparties(user))[0]!.balance).toBe(0);
  });

  // SC-L9
  it('keeps debt transactions and paid-for-me expenses read-only on /transactions', async () => {
    const user = await me();
    await entry(user, 'LEND', 120);
    await entry(user, 'PAID_FOR_ME', 400, {
      record: { ledgerId: user.ledgerId },
      categoryId: await expenseCategoryId(user),
    });

    for (const txn of await ledgerTransactions(user)) {
      const patch = await request(server())
        .patch(`/api/ledgers/${user.ledgerId}/transactions/${txn.id}`)
        .set(auth(user.token))
        .send({ amount: 1 });
      expect(patch.status).toBe(409);
      expect(errorCode(patch)).toBe('DEBT_TRANSACTION_READ_ONLY');

      const del = await request(server())
        .delete(`/api/ledgers/${user.ledgerId}/transactions/${txn.id}`)
        .set(auth(user.token));
      expect(del.status).toBe(409);
    }

    const create = await request(server())
      .post(`/api/ledgers/${user.ledgerId}/transactions`)
      .set(auth(user.token))
      .send({ type: 'LEND', amount: 1, date: DAY, accountId: user.cashId });
    expect(create.status).toBe(400);
  });

  // SC-L10
  it('refuses to hard-delete a ledger that holds a paid-for-me expense', async () => {
    const user = await me();
    const created = await request(server())
      .post('/api/ledgers')
      .set(auth(user.token))
      .send({ name: '旅行', kind: 'PERSONAL' })
      .expect(201);
    const ledgerId = (created.body as { id: string }).id;
    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(user.token))
      .expect(200);

    await entry(user, 'PAID_FOR_ME', 400, {
      record: { ledgerId },
      categoryId: (categories.body as Array<{ id: string }>)[0]!.id,
    });

    const res = await request(server())
      .delete(`/api/ledgers/${ledgerId}`)
      .query({ confirm: '旅行' })
      .set(auth(user.token));
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('LEDGER_HAS_DEBT_TRANSACTIONS');
  });

  // SC-L13
  it('lists entries newest first with the running balance after each', async () => {
    const user = await me();
    const { counterparty } = await entry(user, 'LEND', 120);
    await entry(user, 'BORROW', 111);
    await entry(user, 'COLLECT', 5, { settle: true });

    const list = await entriesOf(user, counterparty.id);
    expect(list.map((e) => [e.kind, e.balanceAfter])).toEqual([
      ['SETTLEMENT', 0],
      ['COLLECT', 4],
      ['BORROW', 9],
      ['LEND', 120],
    ]);
  });

  // SC-L14
  it('renames, refuses a taken name, and deletes only an empty counterparty', async () => {
    const user = await me();
    const ming = await entry(user, 'LEND', 1, { record: null });
    await entry(user, 'LEND', 1, { record: null, counterparty: { name: '小華' } });
    const id = ming.counterparty.id;

    const taken = await request(server())
      .patch(`/api/counterparties/${id}`)
      .set(auth(user.token))
      .send({ name: ' 小華 ' });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe('COUNTERPARTY_NAME_TAKEN');

    await request(server())
      .patch(`/api/counterparties/${id}`)
      .set(auth(user.token))
      .send({ name: '明明' })
      .expect(200);

    const busy = await request(server()).delete(`/api/counterparties/${id}`).set(auth(user.token));
    expect(busy.status).toBe(409);
    expect(errorCode(busy)).toBe('COUNTERPARTY_HAS_ENTRIES');

    await request(server())
      .delete(`/api/debt-entries/${ming.entries[0]!.id}`)
      .set(auth(user.token))
      .expect(204);
    await request(server()).delete(`/api/counterparties/${id}`).set(auth(user.token)).expect(204);
    expect((await counterparties(user)).map((c) => c.name)).toEqual(['小華']);
  });

  it('lists counterparties with a balance before settled ones', async () => {
    const user = await me();
    await entry(user, 'LEND', 5, { record: null, counterparty: { name: '阿兩清' } });
    await entry(user, 'COLLECT', 5, { record: null, counterparty: { name: '阿兩清' } });
    await entry(user, 'LEND', 7, { record: null, counterparty: { name: '欠錢的' } });

    expect((await counterparties(user)).map((c) => [c.name, c.balance])).toEqual([
      ['欠錢的', 7],
      ['阿兩清', 0],
    ]);
  });

  // spec §4.3：delta 的正負號與交易的有無，資料庫另外用 CHECK 擋——繞過 service 也寫不進去。
  it('backs up the sign and transaction rules with database constraints', async () => {
    const user = await me();
    const { counterparty } = await entry(user, 'LEND', 1, { record: null });
    const base = { counterpartyId: counterparty.id, date: new Date(DAY) };

    await expect(
      prisma.debtEntry.create({ data: { ...base, kind: 'LEND', delta: -1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.debtEntry.create({ data: { ...base, kind: 'PAID_FOR_ME', delta: -1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.counterparty.update({ where: { id: counterparty.id }, data: { name: ' 小明' } }),
    ).rejects.toThrow();
  });
});
