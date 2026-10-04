import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computeLedgerNets,
  ErrorCode,
  suggestSettlements,
  type CreateSettlementRequest,
  type LedgerNetEntry,
  type SettlementSummary,
  type Transaction,
  type UpdateSettlementRequest,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import {
  LedgerPeopleService,
  type LedgerPersonRecord,
} from '../ledger-people/ledger-people.service';
import { resolvePayerAccount } from '../ledger-people/payer-account-rules';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

/**
 * 結清是一筆 TRANSFER 與一筆 LedgerSettlement 的配對。所有寫入放在同一個資料庫交易；
 * 修改既有結清時先鎖交易列，再依序鎖兩位帳本裡的人，避免帳戶與欠款關係被併發寫入拆開。
 * summary 只撈原始交易數字，淨額與建議交給 shared 純函式計算。
 */

interface LedgerSettings {
  kind: 'PERSONAL' | 'SHARED';
  tracksBalance: boolean;
}

interface LockedSettlement {
  transactionId: string;
  settlementId: string;
  fromPersonId: string;
  toPersonId: string;
  accountId: string | null;
  toAccountId: string | null;
  amount: number;
  date: Date;
  note: string | null;
}

interface SplitShareRow {
  transactionId: string;
  type: string;
  amount: number;
  payerId: string | null;
  personId: string | null;
  share: number | null;
}

interface SettlementNetRow {
  fromId: string;
  toId: string;
  amount: number;
}

type AccountRuleError = 'ACCOUNT_REQUIRED' | 'ACCOUNT_NOT_ALLOWED' | 'ACCOUNT_NOT_PAYERS';

const SPLIT_SUMMARY_SQL = [
  'SELECT t."id" AS "transactionId", t."type"::text AS "type", t."amount" AS "amount",',
  'COALESCE(t."payerPersonId", creator."id") AS "payerId",',
  'share."personId" AS "personId", share."share" AS "share"',
  'FROM "Transaction" t',
  'INNER JOIN "LedgerSplit" split ON split."transactionId" = t."id"',
  'LEFT JOIN "LedgerShare" share ON share."ledgerSplitId" = split."id"',
  'LEFT JOIN "LedgerPerson" creator ON creator."ledgerId" = t."ledgerId" AND creator."userId" = t."creatorId"',
  'WHERE t."ledgerId" = $1 AND t."deletedAt" IS NULL',
  'ORDER BY t."createdAt", t."id", share."sortOrder", share."id"',
].join(' ');

const SETTLEMENT_SUMMARY_SQL = [
  'SELECT settlement."fromPersonId" AS "fromId", settlement."toPersonId" AS "toId",',
  't."amount" AS "amount"',
  'FROM "Transaction" t',
  'INNER JOIN "LedgerSettlement" settlement ON settlement."transactionId" = t."id"',
  'WHERE t."ledgerId" = $1 AND t."deletedAt" IS NULL',
  'ORDER BY t."createdAt", t."id"',
].join(' ');

const LOCK_SETTLEMENT_SQL = [
  'SELECT t."id" AS "transactionId", settlement."id" AS "settlementId",',
  'settlement."fromPersonId" AS "fromPersonId", settlement."toPersonId" AS "toPersonId",',
  't."accountId" AS "accountId", t."toAccountId" AS "toAccountId",',
  't."amount" AS "amount", t."date" AS "date", t."note" AS "note"',
  'FROM "LedgerSettlement" settlement',
  'INNER JOIN "Transaction" t ON t."id" = settlement."transactionId"',
  'WHERE settlement."id" = $1 AND t."ledgerId" = $2 AND t."deletedAt" IS NULL',
  'FOR UPDATE OF t',
].join(' ');

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: LedgerPeopleService,
    private readonly transactions: TransactionsService,
  ) {}

  async summary(ledgerId: string): Promise<SettlementSummary> {
    const data = await this.prisma.$transaction(async (tx) => {
      await this.assertSharedLedger(tx, ledgerId);
      const ledgerPeople = await this.people.listPeople(tx, ledgerId);
      const splitRows = await tx.$queryRawUnsafe<SplitShareRow[]>(SPLIT_SUMMARY_SQL, ledgerId);
      const settlementRows = await tx.$queryRawUnsafe<SettlementNetRow[]>(
        SETTLEMENT_SUMMARY_SQL,
        ledgerId,
      );
      return { ledgerPeople, splitRows, settlementRows };
    });

    const entries: LedgerNetEntry[] = [];
    const grouped = new Map<
      string,
      {
        type: 'EXPENSE' | 'INCOME';
        amount: number;
        payerId: string | null;
        shares: { personId: string; share: number }[];
      }
    >();
    for (const row of data.splitRows) {
      let entry = grouped.get(row.transactionId);
      if (!entry) {
        if (row.type !== 'EXPENSE' && row.type !== 'INCOME') {
          throw this.summaryFailure();
        }
        entry = { type: row.type, amount: row.amount, payerId: row.payerId, shares: [] };
        grouped.set(row.transactionId, entry);
      }
      if (row.personId !== null && row.share !== null) {
        entry.shares.push({ personId: row.personId, share: row.share });
      }
    }

    for (const entry of grouped.values()) {
      if (entry.payerId === null) throw this.summaryFailure();
      entries.push({
        kind: entry.type,
        payerId: entry.payerId,
        total: entry.amount,
        shares: entry.shares,
      });
    }
    for (const settlement of data.settlementRows) {
      entries.push({
        kind: 'SETTLEMENT',
        fromId: settlement.fromId,
        toId: settlement.toId,
        amount: settlement.amount,
      });
    }

    const orderedPeople = data.ledgerPeople;
    const nets = computeLedgerNets({
      personIds: orderedPeople.map((person) => person.id),
      entries,
    });
    return {
      people: orderedPeople.map((person) => ({
        person: this.people.toView(person),
        net: nets.get(person.id) ?? 0,
      })),
      suggestions: suggestSettlements(
        orderedPeople.map((person) => ({ personId: person.id, net: nets.get(person.id) ?? 0 })),
      ),
    };
  }

  async create(
    ledgerId: string,
    callerUserId: string,
    input: CreateSettlementRequest,
  ): Promise<Transaction> {
    const transactionId = await this.prisma.$transaction(async (tx) => {
      const tracksBalance = await this.assertSharedLedger(tx, ledgerId);
      let fromPersonId = input.fromPersonId;
      if (fromPersonId === undefined) {
        const callerPerson = await this.people.findCallerPerson(tx, ledgerId, callerUserId);
        if (!callerPerson) throw this.notFound('Person not found.');
        fromPersonId = callerPerson.id;
      }

      const lockedPeople = await this.people.lockPeople(
        tx,
        ledgerId,
        [fromPersonId, input.toPersonId],
        { allowLeft: true },
      );
      this.assertDifferentPeople(fromPersonId, input.toPersonId);
      const from = this.personFrom(lockedPeople, fromPersonId);
      const to = this.personFrom(lockedPeople, input.toPersonId);
      const fromAccount = this.resolveAccount({
        tracksBalance,
        payer: from,
        callerUserId,
        requestedAccountId: input.fromAccountId,
        mode: 'CREATE',
        payerChanged: false,
        currentAccountId: null,
      });
      const toAccount = this.resolveAccount({
        tracksBalance,
        payer: to,
        callerUserId,
        requestedAccountId: input.toAccountId,
        mode: 'CREATE',
        payerChanged: false,
        currentAccountId: null,
      });
      await this.checkAccountOwnership(tx, callerUserId, fromAccount);
      await this.checkAccountOwnership(tx, callerUserId, toAccount);

      const transaction = await tx.transaction.create({
        data: {
          ledgerId,
          creatorId: callerUserId,
          type: 'TRANSFER',
          amount: input.amount,
          date: new Date(input.date),
          categoryId: null,
          accountId: fromAccount.accountId,
          toAccountId: toAccount.accountId,
          note: input.note ?? null,
          title: null,
          payerPersonId: null,
          splitId: null,
        },
        select: { id: true },
      });
      await tx.ledgerSettlement.create({
        data: {
          transactionId: transaction.id,
          fromPersonId,
          toPersonId: input.toPersonId,
        },
      });
      return transaction.id;
    });

    return this.transactions.getById(ledgerId, transactionId, callerUserId);
  }

  async update(
    ledgerId: string,
    settlementId: string,
    callerUserId: string,
    input: UpdateSettlementRequest,
  ): Promise<Transaction> {
    const transactionId = await this.prisma.$transaction(async (tx) => {
      const tracksBalance = await this.assertSharedLedger(tx, ledgerId);
      const existing = await this.lockSettlement(tx, ledgerId, settlementId);
      const fromPersonId = input.fromPersonId ?? existing.fromPersonId;
      const toPersonId = input.toPersonId ?? existing.toPersonId;
      const lockedPeople = await this.people.lockPeople(tx, ledgerId, [fromPersonId, toPersonId], {
        allowLeft: true,
      });
      this.assertDifferentPeople(fromPersonId, toPersonId);
      const from = this.personFrom(lockedPeople, fromPersonId);
      const to = this.personFrom(lockedPeople, toPersonId);
      const fromChanged = fromPersonId !== existing.fromPersonId;
      const toChanged = toPersonId !== existing.toPersonId;
      const fromAccount = this.resolveAccount({
        tracksBalance,
        payer: from,
        callerUserId,
        requestedAccountId: input.fromAccountId,
        mode: 'UPDATE',
        payerChanged: fromChanged,
        currentAccountId: existing.accountId,
      });
      const toAccount = this.resolveAccount({
        tracksBalance,
        payer: to,
        callerUserId,
        requestedAccountId: input.toAccountId,
        mode: 'UPDATE',
        payerChanged: toChanged,
        currentAccountId: existing.toAccountId,
      });
      await this.checkAccountOwnership(tx, callerUserId, fromAccount);
      await this.checkAccountOwnership(tx, callerUserId, toAccount);

      const transactionData: Prisma.TransactionUncheckedUpdateInput = {};
      if (input.amount !== undefined) transactionData.amount = input.amount;
      if (input.date !== undefined) transactionData.date = new Date(input.date);
      if (input.note !== undefined) transactionData.note = input.note;
      if (input.fromAccountId !== undefined || fromChanged) {
        transactionData.accountId = fromAccount.accountId;
      }
      if (input.toAccountId !== undefined || toChanged) {
        transactionData.toAccountId = toAccount.accountId;
      }
      if (Object.keys(transactionData).length > 0) {
        await tx.transaction.update({
          where: { id: existing.transactionId },
          data: transactionData,
        });
      }

      const settlementData: Prisma.LedgerSettlementUncheckedUpdateInput = {};
      if (input.fromPersonId !== undefined) settlementData.fromPersonId = fromPersonId;
      if (input.toPersonId !== undefined) settlementData.toPersonId = toPersonId;
      if (Object.keys(settlementData).length > 0) {
        await tx.ledgerSettlement.update({
          where: { id: settlementId },
          data: settlementData,
        });
      }
      return existing.transactionId;
    });

    return this.transactions.getById(ledgerId, transactionId, callerUserId);
  }

  async remove(ledgerId: string, settlementId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertSharedLedger(tx, ledgerId);
      const existing = await this.lockSettlement(tx, ledgerId, settlementId);
      await this.people.lockPeople(tx, ledgerId, [existing.fromPersonId, existing.toPersonId], {
        allowLeft: true,
      });
      await tx.transaction.update({
        where: { id: existing.transactionId },
        data: { deletedAt: new Date() },
      });
    });
  }

  async setAccount(
    ledgerId: string,
    settlementId: string,
    callerUserId: string,
    accountId: string,
  ): Promise<Transaction> {
    const transactionId = await this.prisma.$transaction(async (tx) => {
      const tracksBalance = await this.assertSharedLedger(tx, ledgerId);
      const existing = await this.lockSettlement(tx, ledgerId, settlementId);
      const lockedPeople = await this.people.lockPeople(
        tx,
        ledgerId,
        [existing.fromPersonId, existing.toPersonId],
        { allowLeft: true },
      );
      const from = this.personFrom(lockedPeople, existing.fromPersonId);
      const to = this.personFrom(lockedPeople, existing.toPersonId);

      if (!tracksBalance) {
        throw this.accountRuleError('ACCOUNT_NOT_ALLOWED');
      }
      const isFrom = from.userId === callerUserId;
      const isTo = to.userId === callerUserId;
      if (!isFrom && !isTo) throw this.accountRuleError('ACCOUNT_NOT_PAYERS');
      await this.assertAccountOwned(tx, callerUserId, accountId);

      await tx.transaction.update({
        where: { id: existing.transactionId },
        data: isFrom ? { accountId } : { toAccountId: accountId },
      });
      return existing.transactionId;
    });

    return this.transactions.getById(ledgerId, transactionId, callerUserId);
  }

  private async assertSharedLedger(
    tx: Prisma.TransactionClient,
    ledgerId: string,
  ): Promise<boolean> {
    const ledger: LedgerSettings | null = await tx.ledger.findUnique({
      where: { id: ledgerId },
      select: { kind: true, tracksBalance: true },
    });
    if (!ledger || ledger.kind !== 'SHARED') throw this.notFound('Ledger not found.');
    return ledger.tracksBalance;
  }

  private async lockSettlement(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    settlementId: string,
  ): Promise<LockedSettlement> {
    const rows = await tx.$queryRawUnsafe<LockedSettlement[]>(
      LOCK_SETTLEMENT_SQL,
      settlementId,
      ledgerId,
    );
    if (rows.length !== 1) throw this.notFound('Settlement not found.');
    return rows[0]!;
  }

  private resolveAccount(input: {
    tracksBalance: boolean;
    payer: LedgerPersonRecord;
    callerUserId: string;
    requestedAccountId: string | undefined;
    mode: 'CREATE' | 'UPDATE';
    payerChanged: boolean;
    currentAccountId: string | null;
  }) {
    const result = resolvePayerAccount(input);
    if (!result.ok) throw this.accountRuleError(result.error);
    return result;
  }

  private async checkAccountOwnership(
    tx: Prisma.TransactionClient,
    callerUserId: string,
    result: ReturnType<typeof resolvePayerAccount>,
  ): Promise<void> {
    if (result.ok && result.needsOwnershipCheck && result.accountId !== null) {
      await this.assertAccountOwned(tx, callerUserId, result.accountId);
    }
  }

  private async assertAccountOwned(
    tx: Prisma.TransactionClient,
    callerUserId: string,
    accountId: string,
  ): Promise<void> {
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!account || account.userId !== callerUserId) {
      throw this.notFound('Account not found.');
    }
  }

  private personFrom(
    lockedPeople: Map<string, LedgerPersonRecord>,
    personId: string,
  ): LedgerPersonRecord {
    const person = lockedPeople.get(personId);
    if (!person) throw this.notFound('Person not found.');
    return person;
  }

  private assertDifferentPeople(fromPersonId: string, toPersonId: string): void {
    if (fromPersonId === toPersonId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SETTLEMENT_SAME_PERSON,
        'The paying and receiving people must be different.',
      );
    }
  }

  private accountRuleError(error: AccountRuleError): AppException {
    const messages: Record<AccountRuleError, string> = {
      ACCOUNT_REQUIRED: 'An account is required for your side of this settlement.',
      ACCOUNT_NOT_ALLOWED: 'This ledger does not allow accounts for settlements.',
      ACCOUNT_NOT_PAYERS: 'Only the paying or receiving person can choose their account.',
    };
    return new AppException(HttpStatus.BAD_REQUEST, error, messages[error]);
  }

  private notFound(message: string): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);
  }

  private summaryFailure(): AppException {
    return new AppException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCode.INTERNAL_ERROR,
      'Unable to calculate the settlement summary.',
    );
  }
}
