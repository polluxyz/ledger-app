import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createSharedLedger, httpServer } from './e2e-utils';
import { auth, person } from './linking-utils';
import type { Person } from './linking-utils';

/**
 * 統計與資產測試共用種子。身分及成員經既有 HTTP helper 建立；內部交易與歷史形態用 Prisma，
 * 和 ledger-merged-transactions 的種子策略一致，避免測核心時依賴退出、搬移端點的副作用。
 * 呼叫者負責 resetDb；不自行清表，讓 S1b、S2、S3 能組合各 builder。
 */
export interface StatisticsExamples {
  me: Person;
  mei: Person;
  dailyLedgerId: string;
  homeLedgerId: string;
  mePersonId: string;
  meiPersonId: string;
  savingsId: string;
  categories: {
    breakfast: string;
    lunch: string;
    salary: string;
    dinner: string;
    daily: string;
    refund: string;
  };
}

const OCTOBER_DAY = new Date('2026-10-15T12:00:00+08:00');

/** 原始資料建構入口，日期固定在範例月份；可額外指定舊資料欄位與內部關聯。 */
export function createStatisticsTransaction(
  prisma: PrismaService,
  data: Omit<Prisma.TransactionUncheckedCreateInput, 'date'> & { date?: Date | string },
) {
  return prisma.transaction.create({ data: { date: OCTOBER_DAY, ...data } });
}

/** spec §1「日常」「家用」完整範例，包含資產圖所需的帳戶與不算收支的交易。 */
export async function createStatisticsExamples(
  app: INestApplication,
  prisma: PrismaService,
): Promise<StatisticsExamples> {
  const me = await person(app, 'statistics-me@example.com', '我');
  const mei = await person(app, 'statistics-mei@example.com', '小美');
  const dailyLedgerId = me.ledgerId;
  await prisma.ledger.update({ where: { id: dailyLedgerId }, data: { name: '日常' } });
  const homeLedgerId = await createSharedLedger(app, me.token, '家用');
  await request(httpServer(app))
    .post(`/api/ledgers/${homeLedgerId}/members`)
    .set(auth(me.token))
    .send({ email: mei.email, role: 'EDITOR' })
    .expect(201);
  const mePerson = await prisma.ledgerPerson.findUniqueOrThrow({
    where: { ledgerId_userId: { ledgerId: homeLedgerId, userId: me.userId } },
  });
  const meiPerson = await prisma.ledgerPerson.findUniqueOrThrow({
    where: { ledgerId_userId: { ledgerId: homeLedgerId, userId: mei.userId } },
  });
  await prisma.account.update({ where: { id: me.cashId }, data: { initialBalance: 1000000 } });
  const savings = await prisma.account.create({ data: { userId: me.userId, name: '儲蓄' } });
  const category = async (ledgerId: string, name: string, type: 'EXPENSE' | 'INCOME') =>
    (
      await prisma.category.upsert({
        where: { ledgerId_type_name: { ledgerId, name, type } },
        create: { ledgerId, name, type },
        update: {},
      })
    ).id;
  const categories = {
    breakfast: await category(dailyLedgerId, '早餐', 'EXPENSE'),
    lunch: await category(dailyLedgerId, '午餐', 'EXPENSE'),
    salary: await category(dailyLedgerId, '薪資', 'INCOME'),
    dinner: await category(homeLedgerId, '晚餐', 'EXPENSE'),
    daily: await category(homeLedgerId, '日用品', 'EXPENSE'),
    refund: await category(homeLedgerId, '退款', 'INCOME'),
  };
  const dailyBase = { ledgerId: dailyLedgerId, creatorId: me.userId, accountId: me.cashId };
  for (const [type, amount, categoryId] of [
    ['EXPENSE', 8000, categories.breakfast],
    ['EXPENSE', 12000, categories.lunch],
    ['INCOME', 5000000, categories.salary],
  ] as const)
    await createStatisticsTransaction(prisma, { ...dailyBase, type, amount, categoryId });
  await createStatisticsTransaction(prisma, {
    ...dailyBase,
    type: 'TRANSFER',
    amount: 100000,
    toAccountId: savings.id,
  });
  const ade = await prisma.counterparty.create({ data: { ownerId: me.userId, name: '阿德' } });
  const hua = await prisma.counterparty.create({ data: { ownerId: me.userId, name: '小華' } });
  const lend = await createStatisticsTransaction(prisma, {
    ...dailyBase,
    type: 'LEND',
    amount: 100000,
  });
  await prisma.debtEntry.create({
    data: {
      counterpartyId: ade.id,
      kind: 'LEND',
      delta: 100000,
      date: OCTOBER_DAY,
      transactionId: lend.id,
    },
  });
  const collect = await createStatisticsTransaction(prisma, {
    ...dailyBase,
    type: 'COLLECT',
    amount: 9300,
  });
  const collectionEntry = await prisma.debtEntry.create({
    data: {
      counterpartyId: ade.id,
      kind: 'COLLECT',
      delta: -9300,
      date: OCTOBER_DAY,
      transactionId: collect.id,
    },
  });
  await createStatisticsTransaction(prisma, {
    ...dailyBase,
    type: 'EXPENSE',
    amount: 300,
    differenceOfId: collect.id,
  });
  await prisma.debtEntry.create({
    data: {
      counterpartyId: ade.id,
      kind: 'SETTLEMENT',
      delta: -300,
      date: OCTOBER_DAY,
      settlesEntryId: collectionEntry.id,
    },
  });
  const badDebt = await createStatisticsTransaction(prisma, {
    ledgerId: dailyLedgerId,
    creatorId: me.userId,
    type: 'EXPENSE',
    amount: 50000,
  });
  await prisma.debtEntry.create({
    data: {
      counterpartyId: hua.id,
      kind: 'FORGIVE',
      delta: -50000,
      date: OCTOBER_DAY,
      transactionId: badDebt.id,
    },
  });
  const homeBase = {
    ledgerId: homeLedgerId,
    creatorId: me.userId,
    accountId: me.cashId,
    payerPersonId: mePerson.id,
  };
  const dinner = await createStatisticsTransaction(prisma, {
    ...homeBase,
    type: 'EXPENSE',
    amount: 90000,
    categoryId: categories.dinner,
  });
  await prisma.ledgerSplit.create({
    data: {
      transactionId: dinner.id,
      method: 'EQUAL',
      shares: {
        create: [
          { personId: mePerson.id, share: 45000, sortOrder: 0 },
          { personId: meiPerson.id, share: 45000, sortOrder: 1 },
        ],
      },
    },
  });
  await createStatisticsTransaction(prisma, {
    ...homeBase,
    creatorId: mei.userId,
    accountId: mei.cashId,
    payerPersonId: meiPerson.id,
    type: 'EXPENSE',
    amount: 30000,
    categoryId: categories.daily,
  });
  await createStatisticsTransaction(prisma, {
    ...homeBase,
    type: 'INCOME',
    amount: 20000,
    categoryId: categories.refund,
  });
  return {
    me,
    mei,
    dailyLedgerId,
    homeLedgerId,
    mePersonId: mePerson.id,
    meiPersonId: meiPerson.id,
    savingsId: savings.id,
    categories,
  };
}

export interface StatisticsShapeCase {
  transactionId: string;
  /** 期待的每人份額，不含原交易之外的借還或代墊。 */
  allocations: Array<{ personId: string; amount: bigint }>;
}

/** SC-R28 每種持久化形態與 SC-R9 時間邊界；回傳案例名稱，讓後續端點測試逐種斷言。 */
export async function createStatisticsAttributionShapes(
  app: INestApplication,
  prisma: PrismaService,
  examples: StatisticsExamples,
) {
  const { me, mei, homeLedgerId, dailyLedgerId, mePersonId, meiPersonId, categories } = examples;
  const left = await person(app, 'statistics-left@example.com', '已離開的人');
  // 明確沒有 LedgerMember：不能在統計查詢時把這些人的交易或份額過濾掉。
  const leftPerson = await prisma.ledgerPerson.create({
    data: { ledgerId: homeLedgerId, userId: left.userId },
  });
  const guest = await prisma.ledgerPerson.create({
    data: { ledgerId: homeLedgerId, name: '非成員' },
  });
  const base = {
    ledgerId: homeLedgerId,
    creatorId: me.userId,
    payerPersonId: mePersonId,
    type: 'EXPENSE' as const,
    categoryId: categories.dinner,
  };
  const cases: Record<string, StatisticsShapeCase> = {};
  async function splitCase(
    name: string,
    amount: number,
    allocations: Array<[string, number]>,
    extra: Partial<Prisma.TransactionUncheckedCreateInput> = {},
  ) {
    const transaction = await createStatisticsTransaction(prisma, { ...base, amount, ...extra });
    await prisma.ledgerSplit.create({
      data: {
        transactionId: transaction.id,
        method: 'AMOUNT',
        shares: {
          create: allocations.map(([personId, share], sortOrder) => ({
            personId,
            share,
            sortOrder,
          })),
        },
      },
    });
    cases[name] = {
      transactionId: transaction.id,
      allocations: allocations.map(([personId, share]) => ({ personId, amount: BigInt(share) })),
    };
  }
  await splitCase('payerOutsideShares', 701, [
    [meiPersonId, 301],
    [guest.id, 400],
  ]);
  await splitCase('fullAdvance', 2000, [[guest.id, 2000]]);
  const guestPaid = await createStatisticsTransaction(prisma, {
    ...base,
    amount: 1200,
    payerPersonId: guest.id,
  });
  cases.guestPayer = {
    transactionId: guestPaid.id,
    allocations: [{ personId: guest.id, amount: 1200n }],
  };
  await splitCase('leftMemberShare', 300, [
    [mePersonId, 100],
    [leftPerson.id, 200],
  ]);
  const leftCreated = await createStatisticsTransaction(prisma, {
    ...base,
    creatorId: left.userId,
    payerPersonId: null,
    amount: 401,
  });
  cases.leftCreator = {
    transactionId: leftCreated.id,
    allocations: [{ personId: leftPerson.id, amount: 401n }],
  };
  const counterparty = await prisma.counterparty.create({
    data: { ownerId: me.userId, name: '3c 付款對象' },
  });
  const personalSplit = await prisma.split.create({
    data: {
      ownerId: me.userId,
      ledgerId: dailyLedgerId,
      type: 'EXPENSE',
      categoryId: categories.lunch,
      total: 90000,
      date: OCTOBER_DAY,
      payerCounterpartyId: counterparty.id,
      method: 'EQUAL',
      participants: {
        create: [
          { share: 45000, sortOrder: 0 },
          { share: 45000, sortOrder: 1, counterpartyId: counterparty.id },
        ],
      },
    },
  });
  const paidForMe = await createStatisticsTransaction(prisma, {
    ledgerId: dailyLedgerId,
    creatorId: me.userId,
    type: 'EXPENSE',
    amount: 45000,
    categoryId: categories.lunch,
    splitId: personalSplit.id,
  });
  await prisma.debtEntry.create({
    data: {
      counterpartyId: counterparty.id,
      kind: 'PAID_FOR_ME',
      delta: -45000,
      date: OCTOBER_DAY,
      transactionId: paidForMe.id,
      splitId: personalSplit.id,
    },
  });
  cases.personalPaidForMe = {
    transactionId: paidForMe.id,
    allocations: [{ personId: me.userId, amount: 45000n }],
  };
  const sourceLedgerId = await createSharedLedger(app, me.token, '合併來源');
  const merge = await prisma.ledgerMerge.create({
    data: {
      userId: me.userId,
      sourceLedgerId,
      sourceLedgerName: '合併來源',
      targetLedgerId: homeLedgerId,
    },
  });
  const mergedFromId = randomUUID();
  const merged = await createStatisticsTransaction(prisma, {
    ...base,
    amount: 100000,
    mergeId: merge.id,
    mergedFromId,
  });
  await createStatisticsTransaction(prisma, {
    ...base,
    type: 'LEND',
    categoryId: null,
    amount: 200000,
    mergeId: merge.id,
    mergedFromId,
  });
  cases.mergedToShared = {
    transactionId: merged.id,
    allocations: [{ personId: mePersonId, amount: 100000n }],
  };
  const moved = await createStatisticsTransaction(prisma, {
    ledgerId: dailyLedgerId,
    creatorId: me.userId,
    type: 'EXPENSE',
    amount: 3500,
    categoryId: categories.lunch,
  });
  await prisma.transaction.update({
    where: { id: moved.id },
    data: { ledgerId: homeLedgerId, categoryId: categories.dinner, payerPersonId: mePersonId },
  });
  cases.movedToShared = {
    transactionId: moved.id,
    allocations: [{ personId: mePersonId, amount: 3500n }],
  };
  await splitCase(
    'incomeShares',
    1013,
    [
      [mePersonId, 201],
      [meiPersonId, 307],
      [guest.id, 505],
    ],
    { type: 'INCOME', categoryId: categories.refund },
  );
  const legacy = await createStatisticsTransaction(prisma, {
    ...base,
    payerPersonId: null,
    amount: 109,
  });
  cases.legacyCreator = {
    transactionId: legacy.id,
    allocations: [{ personId: mePersonId, amount: 109n }],
  };
  for (const [name, date, amount] of [
    ['lateOctober', '2026-10-31T23:30:00+08:00', 111],
    ['earlyNovember', '2026-11-01T00:10:00+08:00', 222],
    ['startBoundary', '2026-10-01T00:00:00+08:00', 333],
    ['beforeBoundary', '2026-09-30T23:59:59.999+08:00', 444],
  ] as const) {
    const transaction = await createStatisticsTransaction(prisma, {
      ...base,
      amount,
      date: new Date(date),
    });
    cases[name] = {
      transactionId: transaction.id,
      allocations: [{ personId: mePersonId, amount: BigInt(amount) }],
    };
  }
  await createStatisticsTransaction(prisma, { ...base, amount: 999999, deletedAt: OCTOBER_DAY });
  // 固定分組同時放兩位擁有人的資料，並刻意不以付款人推測歸屬。
  for (const owner of [me, mei]) {
    const cp = await prisma.counterparty.create({
      data: { ownerId: owner.userId, name: '固定分組私密對象' },
    });
    for (const [kind, type, delta] of [
      ['FORGIVE', 'EXPENSE', -701],
      ['FORGIVEN', 'INCOME', 702],
    ] as const) {
      const transaction = await createStatisticsTransaction(prisma, {
        ...base,
        creatorId: owner.userId,
        categoryId: null,
        type,
        amount: Math.abs(delta),
      });
      await prisma.debtEntry.create({
        data: {
          counterpartyId: cp.id,
          kind,
          delta,
          date: OCTOBER_DAY,
          transactionId: transaction.id,
        },
      });
    }
    for (const [type, amount] of [
      ['EXPENSE', 703],
      ['INCOME', 704],
    ] as const) {
      const parent = await createStatisticsTransaction(prisma, {
        ...base,
        creatorId: owner.userId,
        categoryId: null,
        type: 'COLLECT',
        amount: 10000,
      });
      await prisma.debtEntry.create({
        data: {
          counterpartyId: cp.id,
          kind: 'COLLECT',
          delta: -10000,
          date: OCTOBER_DAY,
          transactionId: parent.id,
        },
      });
      await createStatisticsTransaction(prisma, {
        ...base,
        creatorId: owner.userId,
        categoryId: null,
        type,
        amount,
        differenceOfId: parent.id,
      });
    }
  }
  return { cases, guestPersonId: guest.id, leftPersonId: leftPerson.id, left, sourceLedgerId };
}

/** 對照函式所需關聯一次讀入；只供測試使用，正式統計不會逐筆載入交易。 */
export async function readStatisticsReference(prisma: Prisma.TransactionClient, ledgerId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { ledgerId },
    include: {
      creator: { select: { name: true } },
      ledgerSplit: { include: { shares: true } },
      debtEntry: { include: { counterparty: true } },
      differenceOf: { include: { debtEntry: { include: { counterparty: true } } } },
    },
  });
  const people = await prisma.ledgerPerson.findMany({
    where: { ledgerId },
    include: { user: { select: { name: true } } },
  });
  return { transactions, people };
}
