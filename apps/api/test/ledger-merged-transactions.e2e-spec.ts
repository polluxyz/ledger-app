import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { Paginated, Transaction } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, listAccounts, resetDb } from './e2e-utils';
import { auth, person } from './linking-utils';

/**
 * 驗證 3k 合併交易的列表合成、分頁與隱私、決策 202 的有限編輯及成對刪除，
 * 以及 SC-K5 重新加入後的補帳戶規則。直接以 Prisma 建立 LedgerMerge 與內部交易，
 * 模擬退出清帳戶及重新加入，不依賴退出端點，所有行為斷言走真正的交易 API。
 */
describe('Ledger merged transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const date = '2026-10-01T12:00:00.000Z';
  const server = () => httpServer(app);

  beforeAll(async () => ({ app, prisma } = await createE2EApp()));
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function scene(shared = false) {
    const me = await person(app, 'me@example.com', '合併者');
    const other = await person(app, 'other@example.com', '其他成員');
    const targetId = shared ? await createSharedLedger(app, me.token, '目標帳本') : me.ledgerId;
    if (shared) {
      await request(server())
        .post(`/api/ledgers/${targetId}/members`)
        .set(auth(me.token))
        .send({ email: other.email, role: 'EDITOR' })
        .expect(201);
    }
    const sourceId = await createSharedLedger(app, me.token, '花蓮三日');
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: targetId, type: 'EXPENSE' },
    });
    const incomeCategory = await prisma.category.findFirstOrThrow({
      where: { ledgerId: targetId, type: 'INCOME' },
    });
    const merge = await prisma.ledgerMerge.create({
      data: {
        userId: me.userId,
        sourceLedgerId: sourceId,
        sourceLedgerName: '花蓮三日',
        targetLedgerId: targetId,
      },
    });
    const base = {
      ledgerId: targetId,
      creatorId: me.userId,
      accountId: me.cashId,
      mergeId: merge.id,
      mergedFromId: randomUUID(),
      date: new Date(date),
      title: '住宿',
      note: '原始備註',
    };
    const share = await prisma.transaction.create({
      data: { ...base, type: 'EXPENSE', categoryId: category.id, amount: 3000 },
    });
    const advance = await prisma.transaction.create({
      data: { ...base, type: 'LEND', amount: 7000 },
    });
    const root = `/api/ledgers/${targetId}/transactions`;
    return {
      me,
      other,
      targetId,
      sourceId,
      category,
      incomeCategory,
      merge,
      base,
      share,
      advance,
      root,
    };
  }

  it('combines before paging and filtering, keeping zero-share advances and settlements', async () => {
    const s = await scene();
    const zero = await prisma.transaction.create({
      data: { ...s.base, mergedFromId: randomUUID(), type: 'LEND', amount: 900, title: '全額代墊' },
    });
    const settlement = await prisma.transaction.create({
      data: {
        ...s.base,
        mergedFromId: randomUUID(),
        type: 'COLLECT',
        amount: 1200,
        title: '結清 · 小華',
      },
    });
    const incomeFromId = randomUUID();
    const income = await prisma.transaction.create({
      data: {
        ...s.base,
        mergedFromId: incomeFromId,
        type: 'INCOME',
        categoryId: s.incomeCategory.id,
        amount: 500,
      },
    });
    await prisma.transaction.create({
      data: { ...s.base, mergedFromId: incomeFromId, type: 'BORROW', amount: 1500 },
    });
    // 另一輪合併相同原交易，不應與前一輪配對或誤用它的金額。
    const secondMerge = await prisma.ledgerMerge.create({
      data: {
        userId: s.me.userId,
        sourceLedgerId: s.sourceId,
        sourceLedgerName: '第二輪',
        targetLedgerId: s.targetId,
      },
    });
    const another = await prisma.transaction.create({
      data: { ...s.base, mergeId: secondMerge.id, type: 'LEND', amount: 400 },
    });

    const items: Transaction[] = [];
    for (const [page, length] of [
      [1, 2],
      [2, 2],
      [3, 1],
      [4, 0],
    ]) {
      const response = await request(server())
        .get(s.root)
        .query({ page, limit: 2 })
        .set(auth(s.me.token))
        .expect(200);
      const list = response.body as Paginated<Transaction>;
      expect(list.total).toBe(5);
      expect(list.items).toHaveLength(length!);
      items.push(...list.items);
    }
    expect(items.map((item) => item.id).sort()).toEqual(
      [s.share.id, zero.id, settlement.id, income.id, another.id].sort(),
    );
    expect(items.find((item) => item.id === s.share.id)).toMatchObject({
      amount: 10000,
      merge: { sourceLedgerName: '花蓮三日', share: 3000 },
    });
    expect(items.find((item) => item.id === income.id)).toMatchObject({
      amount: 2000,
      merge: { share: 500 },
    });
    for (const id of [zero.id, settlement.id, another.id]) {
      expect(items.find((item) => item.id === id)?.merge?.share).toBeNull();
    }
    for (const query of [
      { categoryId: s.category.id },
      { type: 'EXPENSE' },
      { from: date, to: date, categoryId: s.category.id },
    ]) {
      const response = await request(server())
        .get(s.root)
        .query(query)
        .set(auth(s.me.token))
        .expect(200);
      const list = response.body as Paginated<Transaction>;
      expect(list.total).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        id: s.share.id,
        amount: 10000,
        merge: { share: 3000 },
      });
    }
    const outside = await request(server())
      .get(s.root)
      .query({ from: '2026-10-02T00:00:00Z' })
      .set(auth(s.me.token))
      .expect(200);
    expect(outside.body as Paginated<Transaction>).toMatchObject({ total: 0, items: [] });
  });

  it('returns the same representative from either id and keeps merge metadata private', async () => {
    const s = await scene(true);
    for (const who of [s.me, s.other]) {
      for (const id of [s.share.id, s.advance.id]) {
        const response = await request(server())
          .get(`${s.root}/${id}`)
          .set(auth(who.token))
          .expect(200);
        expect(response.body as Transaction).toMatchObject({
          id: s.share.id,
          amount: 10000,
          merge: who === s.me ? { sourceLedgerName: '花蓮三日', share: 3000 } : null,
          accountPending: false,
        });
      }
      const response = await request(server()).get(s.root).set(auth(who.token)).expect(200);
      const list = response.body as Paginated<Transaction>;
      expect(list.total).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.merge).toEqual(
        who === s.me ? { sourceLedgerName: '花蓮三日', share: 3000 } : null,
      );
      if (who === s.other) expect(list.items[0]?.account).toBeNull();
    }
  });

  it.each([false, true])(
    'allows title, category and account edits and deletes both rows (shared=%s)',
    async (shared) => {
      const s = await scene(shared);
      const category = await prisma.category.create({
        data: { ledgerId: s.targetId, name: '合併專用分類', type: 'EXPENSE' },
      });
      const bank = await prisma.account.create({ data: { userId: s.me.userId, name: '銀行' } });
      const response = await request(server())
        .patch(`${s.root}/${s.advance.id}`)
        .set(auth(s.me.token))
        .send({ title: '新的住宿', categoryId: category.id, accountId: bank.id })
        .expect(200);
      expect(response.body as Transaction).toMatchObject({
        id: s.share.id,
        amount: 10000,
        title: '新的住宿',
        category: { id: category.id },
        account: { id: bank.id },
      });
      const rows = await prisma.transaction.findMany({ where: { mergeId: s.merge.id } });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toMatchObject({ title: '新的住宿', accountId: bank.id });
      expect(rows.find((row) => row.id === s.advance.id)?.categoryId).toBeNull();
      expect(rows.find((row) => row.id === s.share.id)?.categoryId).toBe(category.id);
      await request(server()).delete(`${s.root}/${s.advance.id}`).set(auth(s.me.token)).expect(204);
      expect(
        await prisma.transaction.count({ where: { mergeId: s.merge.id, deletedAt: null } }),
      ).toBe(0);
      expect(await prisma.transaction.count({ where: { mergeId: s.merge.id } })).toBe(2);
      for (const row of rows)
        await request(server()).get(`${s.root}/${row.id}`).set(auth(s.me.token)).expect(404);
    },
  );

  it('rejects changed immutable fields, allowing identical values', async () => {
    const s = await scene();
    for (const body of [
      { amount: 3001 },
      { date: '2026-10-02T12:00:00Z' },
      { type: 'INCOME' },
      { note: '新備註' },
      { payerPersonId: randomUUID() },
      { ledgerSplit: { method: 'EQUAL', shares: [{ personId: randomUUID() }] } },
    ]) {
      await request(server())
        .patch(`${s.root}/${s.share.id}`)
        .set(auth(s.me.token))
        .send(body)
        .expect(400);
    }
    await request(server())
      .patch(`${s.root}/${s.share.id}`)
      .set(auth(s.me.token))
      .send({
        amount: 10000,
        date,
        type: 'EXPENSE',
        note: '原始備註',
        ledgerSplit: null,
        title: '改名',
      })
      .expect(200);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: s.share.id } })).toMatchObject(
      {
        amount: 3000,
        type: 'EXPENSE',
        date: new Date(date),
        note: '原始備註',
      },
    );
  });

  it('checks category ledger/type and account ownership, preserving editor permissions', async () => {
    const s = await scene(true);
    const foreignCategory = await prisma.category.findFirstOrThrow({
      where: { ledgerId: s.other.ledgerId, type: 'EXPENSE' },
    });
    for (const [body, status] of [
      [{ categoryId: foreignCategory.id }, 404],
      [{ categoryId: s.incomeCategory.id }, 400],
      [{ accountId: s.other.cashId }, 404],
    ] as const) {
      await request(server())
        .patch(`${s.root}/${s.share.id}`)
        .set(auth(s.me.token))
        .send(body)
        .expect(status);
    }
    await request(server())
      .patch(`${s.root}/${s.share.id}`)
      .set(auth(s.other.token))
      .send({ title: '編輯者可改', accountId: s.other.cashId })
      .expect(200);
    expect(
      await prisma.transaction.count({ where: { mergeId: s.merge.id, accountId: s.other.cashId } }),
    ).toBe(2);
    await prisma.ledgerMember.update({
      where: { ledgerId_userId: { ledgerId: s.targetId, userId: s.other.userId } },
      data: { role: 'VIEWER' },
    });
    await request(server())
      .patch(`${s.root}/${s.share.id}`)
      .set(auth(s.other.token))
      .send({ title: '不行' })
      .expect(403);
    await request(server()).delete(`${s.root}/${s.share.id}`).set(auth(s.other.token)).expect(403);
    await request(server())
      .get(`/api/ledgers/${s.sourceId}/transactions/${s.share.id}`)
      .set(auth(s.me.token))
      .expect(404);
    await request(server())
      .get(`/api/ledgers/${s.other.ledgerId}/transactions/${s.share.id}`)
      .set(auth(s.me.token))
      .expect(404);
  });

  it('allows standalone debt-type merges, accountless shares and transfers to be edited', async () => {
    const s = await scene();
    const bank = await prisma.account.create({ data: { userId: s.me.userId, name: '銀行' } });
    for (const type of ['LEND', 'BORROW', 'COLLECT'] as const) {
      const row = await prisma.transaction.create({
        data: { ...s.base, mergedFromId: randomUUID(), type, amount: 1000 },
      });
      await request(server())
        .patch(`${s.root}/${row.id}`)
        .set(auth(s.me.token))
        .send({ title: '改名', accountId: bank.id })
        .expect(200);
      await request(server())
        .patch(`${s.root}/${row.id}`)
        .set(auth(s.me.token))
        .send({ categoryId: s.category.id })
        .expect(400);
      await request(server()).delete(`${s.root}/${row.id}`).set(auth(s.me.token)).expect(204);
    }
    const noAccount = await prisma.transaction.create({
      data: {
        ...s.base,
        mergedFromId: randomUUID(),
        type: 'EXPENSE',
        amount: 1000,
        categoryId: s.category.id,
        accountId: null,
      },
    });
    await request(server())
      .patch(`${s.root}/${noAccount.id}`)
      .set(auth(s.me.token))
      .send({ title: '別人替我付' })
      .expect(200);
    const transfer = await prisma.transaction.create({
      data: {
        ...s.base,
        mergedFromId: randomUUID(),
        type: 'TRANSFER',
        amount: 1000,
        toAccountId: bank.id,
      },
    });
    await request(server())
      .patch(`${s.root}/${transfer.id}`)
      .set(auth(s.me.token))
      .send({ accountId: bank.id, toAccountId: s.me.cashId })
      .expect(200);
    await request(server())
      .patch(`${s.root}/${transfer.id}`)
      .set(auth(s.me.token))
      .send({ toAccountId: bank.id })
      .expect(400);
    await request(server())
      .patch(`${s.root}/${transfer.id}`)
      .set(auth(s.me.token))
      .send({ toAccountId: s.other.cashId })
      .expect(404);
  });

  it('SC-K5: rejoining keeps merged originals nonpending and rejects account replacement', async () => {
    const s = await scene();
    const payer = await prisma.ledgerPerson.findUniqueOrThrow({
      where: { ledgerId_userId: { ledgerId: s.sourceId, userId: s.me.userId } },
    });
    const category = await prisma.category.findFirstOrThrow({
      where: { ledgerId: s.sourceId, type: 'EXPENSE' },
    });
    const originals = await Promise.all(
      [0, 1].map(() =>
        prisma.transaction.create({
          data: {
            ledgerId: s.sourceId,
            creatorId: s.me.userId,
            payerPersonId: payer.id,
            type: 'EXPENSE',
            categoryId: category.id,
            accountId: s.me.cashId,
            amount: 10000,
            date: new Date(date),
          },
        }),
      ),
    );
    await prisma.transaction.updateMany({
      where: { mergeId: s.merge.id },
      data: { mergedFromId: originals[0]!.id },
    });
    // 別人的合併不代表我已合併過；同一來源交易的防重複判斷必須按人隔離。
    const othersMerge = await prisma.ledgerMerge.create({
      data: {
        sourceLedgerId: s.sourceId,
        sourceLedgerName: '花蓮三日',
        userId: s.other.userId,
        targetLedgerId: s.other.ledgerId,
      },
    });
    await prisma.transaction.create({
      data: {
        ledgerId: s.other.ledgerId,
        creatorId: s.other.userId,
        mergeId: othersMerge.id,
        mergedFromId: originals[1]!.id,
        type: 'LEND',
        amount: 10000,
        date: new Date(date),
      },
    });
    await prisma.transaction.updateMany({
      where: { ledgerId: s.sourceId },
      data: { accountId: null },
    });
    await prisma.ledgerMember.delete({
      where: { ledgerId_userId: { ledgerId: s.sourceId, userId: s.me.userId } },
    });
    const beforeRejoin = await listAccounts(app, s.me.token);
    await prisma.ledgerMember.create({
      data: { ledgerId: s.sourceId, userId: s.me.userId, role: 'EDITOR' },
    });
    const before = await listAccounts(app, s.me.token);
    expect(before).toEqual(beforeRejoin);
    const root = `/api/ledgers/${s.sourceId}/transactions`;
    const list = (await request(server()).get(root).set(auth(s.me.token)).expect(200))
      .body as Paginated<Transaction>;
    expect(list.items.find((row) => row.id === originals[0]!.id)?.accountPending).toBe(false);
    expect(list.items.find((row) => row.id === originals[1]!.id)?.accountPending).toBe(true);
    const detail = (
      await request(server()).get(`${root}/${originals[0]!.id}`).set(auth(s.me.token)).expect(200)
    ).body as Transaction;
    expect(detail).toMatchObject({ account: null, accountPending: false, merge: null });
    const blocked = await request(server())
      .put(`${root}/${originals[0]!.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(409);
    expect(blocked.body as { errorCode: string }).toMatchObject({
      errorCode: 'TRANSACTION_ALREADY_MERGED',
    });
    expect(await listAccounts(app, s.me.token)).toEqual(before);
    await request(server())
      .patch(`${root}/${originals[0]!.id}`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(409);
    await request(server())
      .put(`${root}/${originals[1]!.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(200);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: originals[1]!.id } })).accountId,
    ).toBe(s.me.cashId);
    // 合併交易刪除也不能讓來源重複補帳戶。
    await request(server()).delete(`${s.root}/${s.share.id}`).set(auth(s.me.token)).expect(204);
    await request(server())
      .put(`${root}/${originals[0]!.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(409);
  });

  it('keeps temporary merged accounts nonpending and routes edits through the editor endpoint', async () => {
    const s = await scene(true);
    const temporary = await prisma.account.findFirstOrThrow({
      where: { userId: s.me.userId, isTemporary: true },
    });
    await prisma.transaction.updateMany({
      where: { mergeId: s.merge.id },
      data: { accountId: temporary.id },
    });
    const response = await request(server())
      .get(`${s.root}/${s.share.id}`)
      .set(auth(s.me.token))
      .expect(200);
    expect((response.body as Transaction).accountPending).toBe(false);
    await request(server())
      .put(`${s.root}/${s.share.id}/account`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(400);
    await request(server())
      .patch(`${s.root}/${s.share.id}`)
      .set(auth(s.me.token))
      .send({ accountId: s.me.cashId })
      .expect(200);
    expect(
      await prisma.transaction.count({ where: { mergeId: s.merge.id, accountId: s.me.cashId } }),
    ).toBe(2);
  });

  it('serializes concurrent edits through either component id without separating the pair', async () => {
    const s = await scene();
    await Promise.all(
      [s.share.id, s.advance.id].map((id, index) =>
        request(server())
          .patch(`${s.root}/${id}`)
          .set(auth(s.me.token))
          .send({ title: `同時編輯 ${index}` })
          .expect(200),
      ),
    );
    const rows = await prisma.transaction.findMany({ where: { mergeId: s.merge.id } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe(rows[1]!.title);
    expect(['同時編輯 0', '同時編輯 1']).toContain(rows[0]!.title);
  });
});
