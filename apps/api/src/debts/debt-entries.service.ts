import { HttpStatus, Injectable } from '@nestjs/common';
import {
  actualAmountOf,
  ErrorCode,
  mergeTotals,
  SETTLEABLE_DEBT_ENTRY_KINDS,
} from '@ledger/shared';
import type { CreateDebtEntryResponse, DebtEntry, UpdateDebtEntryRequest } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerDebtsService } from '../ledger-groups/ledger-debts.service';
import { TransactionsService } from '../transactions/transactions.service';
import { proposeAmend, proposeCreate, proposeDelete, syncStatuses } from './debt-proposal-rules';
import {
  recordDebtTransaction,
  recalculateSettlement,
  voidRepaymentWithSettlement,
  writeDifference,
} from './debt-recording';
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
 *   分支四樣東西，中途失敗只寫了一半，帳戶餘額與往來餘額就永遠對不起來。授權檢查也一起放
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
    private readonly ledgerDebts: LedgerDebtsService,
  ) {}

  /** 記一筆往來；帶 `settle` 時還款清掉全部欠款，實收差額另記交易分支。 */
  async create(userId: string, input: CreateDebtEntryDto): Promise<CreateDebtEntryResponse> {
    assertEntryShape(input);

    const response = await this.prisma.$transaction(async (tx) => {
      const counterparty = await this.resolveCounterparty(tx, userId, input.counterparty);
      // 先鎖對象再讀餘額：還款方向、超額檢查與分支金額都依賴「寫入前的餘額」（決策 50）。
      await lockCounterparty(tx, counterparty.id);

      // 還款的方向由後端依餘額決定（決策 46）；要在建立交易之前定案，交易型別跟著它走。
      const balanceBefore =
        input.kind === 'REPAYMENT' ? await currentBalance(tx, counterparty.id) : 0;
      const kind: RecordedDebtEntryKind =
        input.kind === 'REPAYMENT'
          ? resolveRepayment(balanceBefore, input.amount, input.settle === true)
          : input.kind;

      const date = new Date(input.date);
      const clearedAmount = input.settle === true ? Math.abs(balanceBefore) : input.amount;
      const transactionId = await this.recordTransaction(
        tx,
        userId,
        input,
        kind,
        date,
        clearedAmount,
      );

      const entry = await tx.debtEntry.create({
        data: {
          counterpartyId: counterparty.id,
          kind,
          delta: deltaFor(kind, clearedAmount),
          date,
          note: input.note ?? null,
          transactionId,
        },
      });
      if (input.settle === true) {
        await writeDifference(tx, this.transactions, entry, input.amount);
      }

      await proposeCreate(tx, {
        fromUserId: userId,
        entry,
        amount: input.amount,
        settle: input.settle === true,
      });

      const [links, sync] = await Promise.all([
        linkInfoFor(tx, [counterparty.id]),
        syncStatuses(tx, [entry]),
      ]);
      return {
        counterparty: toCounterparty(
          counterparty,
          await currentBalance(tx, counterparty.id),
          links.get(counterparty.id) ?? null,
        ),
        entries: [
          toDebtEntry(entry, {
            sync: sync.get(entry.id),
            difference: await this.differenceOf(tx, entry.transactionId),
          }),
        ],
      };
    });
    // 交易提交後再讀帳本來源，確保新紀錄的回應也使用與列表相同的總額。
    const parts = await this.ledgerDebts.partsByCounterparty(userId);
    response.counterparty.ledgerParts = parts.get(response.counterparty.id) ?? [];
    response.counterparty.totalBalance = mergeTotals(
      response.counterparty.balance,
      response.counterparty.ledgerParts,
    );
    return response;
  }

  /**
   * 改金額、日期、備註（決策 41）。對應的交易一起改，否則帳戶餘額與往來餘額會對不起來。
   * 調整紀錄是系統算出來的，不能改（決策 40）；要調整就刪掉重記。
   *
   * 有分支的還款改實收時，只重算分支，讓餘額仍然歸零（3h 決策 172）；改成超過原本
   * 欠款也可以（差額方向反過來），不做超額檢查。已配對或還在等對方確認的紀錄，改金額或日期
   * 會送變更給對方（決策 67）；只改備註不送，備註各記各的。先鎖對象：與對方同時接受提議時，
   * 兩邊對配對狀態的讀寫要排隊。
   */
  update(userId: string, entryId: string, input: UpdateDebtEntryRequest): Promise<DebtEntry> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedEntry(tx, userId, entryId);
      if (existing.splitId != null)
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SPLIT_ENTRY_READ_ONLY,
          'Change this entry through its split.',
        );
      await lockCounterparty(tx, existing.counterpartyId);
      if (isAdjustment(existing.kind)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DEBT_ENTRY_NOT_EDITABLE,
          'Settlement and forgiveness entries cannot be edited; delete and record again.',
        );
      }

      // 正負號沿用原本那一筆（由種類決定，不會因為改金額而翻轉）。
      const proposedDelta =
        input.amount === undefined ? undefined : Math.sign(existing.delta) * input.amount;
      const date = input.date === undefined ? undefined : new Date(input.date);

      // 先重算分支再改還款；有分支時欠款已全清，不能拿實收改動還款的 delta。
      const branchHandled =
        input.amount !== undefined
          ? await recalculateSettlement(tx, existing, input.amount, date)
          : false;
      if (date !== undefined && input.amount === undefined && existing.transactionId !== null) {
        await tx.transaction.updateMany({
          where: { differenceOfId: existing.transactionId, deletedAt: null },
          data: { date },
        });
      }
      const delta = branchHandled ? undefined : proposedDelta;

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
          ...(delta !== undefined ? { amount: input.amount } : {}),
          ...(date !== undefined ? { date } : {}),
        });
      }

      const difference = await this.differenceOf(tx, updated.transactionId);
      const amountChanged =
        input.amount !== undefined && (branchHandled || delta !== existing.delta);
      const dateChanged = date !== undefined && date.getTime() !== existing.date.getTime();
      if (amountChanged || dateChanged) {
        const actualAmount =
          input.amount ??
          (updated.kind === 'COLLECT' || updated.kind === 'REPAY'
            ? actualAmountOf(updated.kind, Math.abs(updated.delta), difference)
            : undefined);
        await proposeAmend(tx, {
          fromUserId: userId,
          entry: updated,
          now: new Date(),
          actualAmount,
        });
      }

      const sync = await syncStatuses(tx, [updated]);
      return toDebtEntry(updated, {
        sync: sync.get(updated.id),
        difference,
      });
    });
  }

  /**
   * 軟刪除一筆往來紀錄，連同它的交易（決策 42）。還款有分支時，分支在同一個時間戳一起
   * 撤銷（3g 決策 156）；綁定的差額不能單獨撤銷（決策 157），要撤就撤那筆還款。已配對的
   * 紀錄同時送刪除給對方（只送還款那筆——分支本來就不配對）；還在等對方確認的新增直接作廢
   * （決策 67）。
   */
  remove(userId: string, entryId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedEntry(tx, userId, entryId);
      if (existing.splitId != null)
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SPLIT_ENTRY_READ_ONLY,
          'Change this entry through its split.',
        );
      await lockCounterparty(tx, existing.counterpartyId);
      if (existing.kind === 'SETTLEMENT' && existing.settlesEntryId !== null) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SETTLEMENT_BOUND_TO_REPAYMENT,
          'This settlement belongs to a repayment; withdraw the repayment instead.',
        );
      }
      const deletedAt = new Date();
      await voidRepaymentWithSettlement(tx, this.transactions, existing, deletedAt);
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
   * 依必填的 `record` 產生交易，回傳交易 id。
   *
   * 帳本權限在建立之前檢查：不是成員、只有 VIEWER、或已封存，整個資料庫交易就回滾。
   * 帳戶規則（連動帳本必填、帳戶屬於本人）與分類規則由 `TransactionsService` 把關，
   * 與一般交易同一份實作。
   */
  private async recordTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateDebtEntryDto,
    kind: 'LEND' | 'BORROW' | 'COLLECT' | 'REPAY',
    date: Date,
    amount: number,
  ): Promise<string> {
    return recordDebtTransaction(tx, this.transactions, {
      userId,
      record: input.record,
      kind,
      amount,
      date,
    });
  }

  /** 只回傳還在生效的分支；還款回應掛這筆交易，舊版差額紀錄不會混入。 */
  private async differenceOf(tx: Prisma.TransactionClient, transactionId: string | null) {
    if (transactionId === null) return null;
    const branch = await tx.transaction.findFirst({
      where: { differenceOfId: transactionId, deletedAt: null },
      select: { id: true, type: true, amount: true },
    });
    return branch
      ? {
          transactionId: branch.id,
          type: branch.type as 'EXPENSE' | 'INCOME',
          amount: branch.amount,
        }
      : null;
  }
}

/**
 * 種類與其他欄位的組合規則（spec §5.2）。DTO 只驗得了各欄位的格式，組合在這裡一次驗完，
 * 違反一律 400，而且發生在碰資料庫之前。
 */
function assertEntryShape(input: CreateDebtEntryDto): void {
  if ((input.kind as string) === 'PAID_FOR_ME')
    throw badRequest('PAID_FOR_ME must be created through /splits.');
  const hasId = input.counterparty.id !== undefined;
  const hasName = input.counterparty.name !== undefined;
  if (hasId === hasName) {
    throw badRequest('counterparty needs exactly one of id or name.');
  }
  // 「省略」不再代表任何預設（spec §5.2）：要不要產生交易必須說清楚。
  if (input.record === undefined || input.record === null) {
    throw badRequest('record is required.');
  }

  if (input.categoryId !== undefined)
    throw badRequest('categoryId is only valid for split entries.');

  if (
    input.settle !== undefined &&
    !(SETTLEABLE_DEBT_ENTRY_KINDS as readonly string[]).includes(input.kind)
  ) {
    throw badRequest('settle is only valid for REPAYMENT.');
  }
}
