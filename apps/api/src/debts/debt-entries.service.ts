import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, SETTLEABLE_DEBT_ENTRY_KINDS } from '@ledger/shared';
import type { CreateDebtEntryResponse, DebtEntry, UpdateDebtEntryRequest } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import { proposeAmend, proposeCreate, proposeDelete, syncStatuses } from './debt-proposal-rules';
import { recordDebtTransaction, writeSettlement } from './debt-recording';
import {
  badRequest,
  currentBalance,
  deltaFor,
  isAdjustment,
  loadOwnedCounterparty,
  loadOwnedEntry,
  lockCounterparty,
  resolveRepayment,
  toCounterparty,
  toDebtEntry,
} from './debt-entry-rules';
import { linkInfoFor } from './counterparty-links';
import type { RecordedDebtEntryKind } from './debt-entry-rules';
import type { CreateDebtEntryDto } from './dto/create-debt-entry.dto';

/**
 * 往來紀錄：記一筆、改、刪。規格見 `docs/specs/phase-3b-debts.md` §3、§5.2。
 *
 * 三條貫穿全檔的規則：
 * - **每個方法整個包在一個 `$transaction` 裡**。記一筆可能同時寫對象、交易、往來紀錄與結清
 *   差額四樣東西，中途失敗只寫了一半，帳戶餘額與往來餘額就永遠對不起來。授權檢查也一起放
 *   進去，讓「檢查失敗」與「什麼都沒寫」是同一件事——連新建的對象也不會留下（SC-L11）。
 * - **`delta` 的正負號只由種類決定**（`deltaFor`），呼叫者只給正的金額。資料庫另有 CHECK。
 * - **讀一律走 `loadOwnedCounterparty` / `loadOwnedEntry`**，不是自己的一律 404。
 *
 * 連動（spec 3b-2）只在這裡加一個動作：寫入之後呼叫 `propose*`，在同一個資料庫交易裡
 * 送提議給對方。對象沒有連動時那些函式什麼都不做。
 */
@Injectable()
export class DebtEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /** 記一筆往來；帶 `settle` 時同一個資料庫交易裡補一筆結清差額（決策 38）。 */
  async create(userId: string, input: CreateDebtEntryDto): Promise<CreateDebtEntryResponse> {
    assertEntryShape(input);

    return this.prisma.$transaction(async (tx) => {
      const counterparty = await this.resolveCounterparty(tx, userId, input.counterparty);
      // 先鎖對象再讀餘額：還款的方向、超額檢查、結清差額都依賴「寫入前的餘額」（決策 50）。
      await lockCounterparty(tx, counterparty.id);

      // 還款的方向由後端依餘額決定（決策 46）；要在建立交易之前定案，交易型別跟著它走。
      const kind: RecordedDebtEntryKind =
        input.kind === 'REPAYMENT'
          ? resolveRepayment(
              await currentBalance(tx, counterparty.id),
              input.amount,
              input.settle === true,
            )
          : input.kind;

      const date = new Date(input.date);
      const transactionId = await this.recordTransaction(tx, userId, input, kind, date);

      const entry = await tx.debtEntry.create({
        data: {
          counterpartyId: counterparty.id,
          kind,
          delta: deltaFor(kind, input.amount),
          date,
          note: input.note ?? null,
          transactionId,
        },
      });
      const entries = [entry];

      if (input.settle === true) {
        const settlement = await writeSettlement(tx, counterparty.id, entry);
        if (settlement !== null) {
          entries.push(settlement);
        }
      }

      await proposeCreate(tx, {
        fromUserId: userId,
        entry,
        amount: input.amount,
        settle: input.settle === true,
      });

      const [links, sync] = await Promise.all([
        linkInfoFor(tx, [counterparty.id]),
        syncStatuses(tx, entries),
      ]);
      return {
        counterparty: toCounterparty(
          counterparty,
          await currentBalance(tx, counterparty.id),
          links.get(counterparty.id) ?? null,
        ),
        entries: entries.map((row) => toDebtEntry(row, { sync: sync.get(row.id) })),
      };
    });
  }

  /**
   * 改金額、日期、備註（決策 41）。對應的交易一起改，否則帳戶餘額與往來餘額會對不起來。
   * 調整紀錄是系統算出來的，不能改（決策 40）；要調整就刪掉重記。
   *
   * 已配對或還在等對方確認的紀錄，改金額或日期會送變更給對方（決策 67）；只改備註不送，
   * 備註各記各的。先鎖對象：與對方同時接受提議時，兩邊對配對狀態的讀寫要排隊。
   */
  update(userId: string, entryId: string, input: UpdateDebtEntryRequest): Promise<DebtEntry> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedEntry(tx, userId, entryId);
      await lockCounterparty(tx, existing.counterpartyId);
      if (isAdjustment(existing.kind)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DEBT_ENTRY_NOT_EDITABLE,
          'Settlement and forgiveness entries cannot be edited; delete and record again.',
        );
      }

      // 正負號沿用原本那一筆（由種類決定，不會因為改金額而翻轉）。
      const delta =
        input.amount === undefined ? undefined : Math.sign(existing.delta) * input.amount;
      const date = input.date === undefined ? undefined : new Date(input.date);

      const updated = await tx.debtEntry.update({
        where: { id: existing.id },
        data: {
          ...(delta !== undefined ? { delta } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      });

      if (existing.transactionId !== null && (input.amount !== undefined || date !== undefined)) {
        await this.transactions.updateDebtTransaction(tx, existing.transactionId, {
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(date !== undefined ? { date } : {}),
        });
      }

      const amountChanged = delta !== undefined && delta !== existing.delta;
      const dateChanged = date !== undefined && date.getTime() !== existing.date.getTime();
      if (amountChanged || dateChanged) {
        await proposeAmend(tx, { fromUserId: userId, entry: updated, now: new Date() });
      }

      const sync = await syncStatuses(tx, [updated]);
      return toDebtEntry(updated, { sync: sync.get(updated.id) });
    });
  }

  /**
   * 軟刪除一筆往來紀錄，連同它的交易（決策 42）。用同一個時間戳，稽核時看得出是同一次刪除。
   * 已配對的紀錄同時送刪除給對方；還在等對方確認的新增直接作廢（決策 67）。
   */
  remove(userId: string, entryId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedEntry(tx, userId, entryId);
      await lockCounterparty(tx, existing.counterpartyId);
      const deletedAt = new Date();
      await tx.debtEntry.update({ where: { id: existing.id }, data: { deletedAt } });
      await this.transactions.softDeleteDebtTransactions(
        tx,
        existing.transactionId === null ? [] : [existing.transactionId],
        deletedAt,
      );
      await proposeDelete(tx, { fromUserId: userId, entry: existing, now: deletedAt });
    });
  }

  /**
   * 找出這筆往來的對象：給 id 就讀既有的（不是自己的一律 404）；給名字就用名字找，找不到
   * 就建立（決策 33）。用 upsert 而不是「先查再建」：兩個請求同時用同一個新名字記帳時，
   * 資料庫的唯一索引會讓它們落到同一個對象，不會因為競態而失敗。
   */
  private async resolveCounterparty(
    tx: Prisma.TransactionClient,
    userId: string,
    ref: CreateDebtEntryDto['counterparty'],
  ) {
    if (ref.id !== undefined) {
      return loadOwnedCounterparty(tx, userId, ref.id);
    }
    const name = ref.name!;
    return tx.counterparty.upsert({
      where: { ownerId_name: { ownerId: userId, name } },
      update: {},
      create: { ownerId: userId, name },
    });
  }

  /**
   * 依 `record` 產生交易，回傳交易 id；`record: null` 就不產生（決策 7）。
   *
   * 帳本權限在建立之前檢查：不是成員、只有 VIEWER、或已封存，整個資料庫交易就回滾。
   * 帳戶規則（連動帳本必填、帳戶屬於本人）與分類規則由 `TransactionsService` 把關，
   * 與一般交易同一份實作。
   */
  private async recordTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateDebtEntryDto,
    kind: RecordedDebtEntryKind,
    date: Date,
  ): Promise<string | null> {
    if (kind !== 'PAID_FOR_ME') {
      return recordDebtTransaction(tx, this.transactions, {
        userId,
        record: input.record,
        kind,
        amount: input.amount,
        date,
      });
    }
    // 代付的 record 不可能是 null（assertEntryShape 已擋），這裡只是讓型別收斂。
    if (input.record === null) {
      return null;
    }
    await assertLedgerWritable(tx, userId, input.record.ledgerId);
    return this.transactions.createPaidForMeExpense(tx, {
      ledgerId: input.record.ledgerId,
      creatorId: userId,
      amount: input.amount,
      date,
      categoryId: input.categoryId!,
    });
  }
}

/**
 * 種類與其他欄位的組合規則（spec §5.2）。DTO 只驗得了各欄位的格式，組合在這裡一次驗完，
 * 違反一律 400，而且發生在碰資料庫之前。
 */
function assertEntryShape(input: CreateDebtEntryDto): void {
  const hasId = input.counterparty.id !== undefined;
  const hasName = input.counterparty.name !== undefined;
  if (hasId === hasName) {
    throw badRequest('counterparty needs exactly one of id or name.');
  }
  // 「省略」不再代表任何預設（spec §5.2）：要不要產生交易必須說清楚。
  if (input.record === undefined) {
    throw badRequest('record is required: an object to record a transaction, or null for none.');
  }

  if (input.kind === 'PAID_FOR_ME') {
    if (input.record === null) {
      throw badRequest('PAID_FOR_ME always records an expense, so record cannot be null.');
    }
    if (input.record.accountId !== undefined) {
      throw badRequest('PAID_FOR_ME is paid by the other person, so it cannot name an account.');
    }
    if (input.categoryId === undefined) {
      throw badRequest('categoryId is required for PAID_FOR_ME.');
    }
  } else if (input.categoryId !== undefined) {
    throw badRequest('categoryId is only valid for PAID_FOR_ME.');
  }

  if (
    input.settle !== undefined &&
    !(SETTLEABLE_DEBT_ENTRY_KINDS as readonly string[]).includes(input.kind)
  ) {
    throw badRequest('settle is only valid for REPAYMENT.');
  }
}
