import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { CreateDebtPaymentRequest, Debt, DebtRecordTarget } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import {
  DEBT_INCLUDE,
  computeDebtState,
  debtNotOpen,
  debtNotFound,
  debtOverpayment,
  loadOwnedDebt,
  paymentTransactionType,
  toDebt,
} from './debt-state';
import type { DebtRow } from './debt-state';

/**
 * 債務的還款與免除。規格見 `docs/specs/phase-3b-debts.md` §3.2、§5.1。
 *
 * 三條貫穿全檔的規則：
 * - **每個方法整個包在一個 `$transaction` 裡**。還款要同時寫 `DebtPayment` 與交易兩張表，
 *   中途失敗只寫了一半的話，帳戶餘額與未清餘額就永遠對不起來。授權檢查也一起放進去，
 *   讓「檢查失敗」與「什麼都沒寫」是同一件事（SC-D10 的 e2e 會回頭確認沒有殘留的還款列）。
 * - **狀態不用存**：`computeDebtState` 每次現算，所以刪掉一筆還款，已結清的債務會自動
 *   回到 `OPEN`，不需要任何補償邏輯。
 * - **讀單筆債務一律走 `loadOwnedDebt`**，不是自己的、已刪除的、不存在的一律同樣 404。
 */
@Injectable()
export class DebtPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /**
   * 記一筆還款，回傳更新後的債務。
   *
   * `settles`（以此結清，spec 決策 30）只放寬一件事：金額可以多於未清餘額。狀態仍必須
   * 是 `OPEN`——已有結清還款的債務算出來就是 `SETTLED`，會在這裡被擋下。兩個請求同時
   * 讀到 `OPEN` 的競態由資料庫的部分唯一索引擋，第二筆會以 `P2002` 失敗，這裡轉成同一個
   * `DEBT_NOT_OPEN`。那個例外發生在 `$transaction` 裡面，整個交易已經回滾，所以接在外層。
   */
  async create(userId: string, debtId: string, input: CreateDebtPaymentRequest): Promise<Debt> {
    try {
      return await this.createInTransaction(userId, debtId, input);
    } catch (error) {
      if (
        input.settles === true &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw debtNotOpen();
      }
      throw error;
    }
  }

  private createInTransaction(
    userId: string,
    debtId: string,
    input: CreateDebtPaymentRequest,
  ): Promise<Debt> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedDebt(tx, userId, debtId);

      // 已結清或已免除的債務不該再收到錢。狀態是算出來的，所以這裡問的一定是當下的事實。
      const { outstanding, status } = computeDebtState(row);
      if (status !== 'OPEN') {
        throw debtNotOpen();
      }
      // 剛好還完未清餘額是允許的，那正是「結清」。超過才擋——除非使用者明說「以此結清」。
      const settles = input.settles === true;
      if (!settles && input.amount > outstanding) {
        throw debtOverpayment();
      }

      const target = resolveRecordTarget(row, input.record);
      const transactionId =
        target === null ? null : await this.recordPayment(tx, userId, row, input, target);

      await tx.debtPayment.create({
        data: {
          debtId: row.id,
          amount: input.amount,
          date: new Date(input.date),
          note: input.note ?? null,
          transactionId,
          settles,
        },
      });

      // 重讀而不是自己拼回應：未清餘額與狀態由 `toDebt` 依最新的還款列表現算。
      return toDebt(await loadOwnedDebt(tx, userId, debtId));
    });
  }

  /**
   * 軟刪除一筆還款與它的交易。
   *
   * 找不到還款時回的是「債務不存在」的同一個 404：若這裡另給一種錯誤，別人的還款 id
   * 就能被一個一個試出來。已軟刪除的還款也走同一條路，重複刪除不會把時間覆寫掉。
   */
  remove(userId: string, debtId: string, paymentId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedDebt(tx, userId, debtId);

      const payment = row.payments.find(
        (candidate) => candidate.id === paymentId && candidate.deletedAt === null,
      );
      if (payment === undefined) {
        throw debtNotFound();
      }

      const deletedAt = new Date();
      await tx.debtPayment.update({ where: { id: payment.id }, data: { deletedAt } });
      await this.transactions.softDeleteDebtTransactions(
        tx,
        payment.transactionId === null ? [] : [payment.transactionId],
        deletedAt,
      );
    });
  }

  /**
   * 免除剩餘金額，回傳更新後的債務。
   *
   * 不產生任何交易（spec 決策 8）：借出的當下錢就已經離開帳戶了，免除只是承認它不會回來。
   * 檢查順序固定為擁有者（404）→ 方向（409）→ 狀態（409）：先確認債務屬於自己，才回答
   * 任何關於它內容的問題。
   */
  forgive(userId: string, debtId: string): Promise<Debt> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedDebt(tx, userId, debtId);

      // 只有債權人能免除。我欠別人的錢，不是我說不用還就不用還。
      if (row.direction !== 'LENT') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DEBT_NOT_FORGIVABLE,
          'Only money you lent can be forgiven.',
        );
      }
      if (computeDebtState(row).status !== 'OPEN') {
        throw debtNotOpen();
      }

      const updated = await tx.debt.update({
        where: { id: row.id },
        data: { forgivenAt: new Date() },
        include: DEBT_INCLUDE,
      });
      return toDebt(updated);
    });
  }

  /**
   * 產生還款的那筆交易，回傳交易 id。
   *
   * 授權在建立之前做：帳本不是自己的、只有 VIEWER、或已封存，整個 `$transaction` 就回滾，
   * 不會留下孤兒還款列。交易型別由債務方向決定，呼叫者指定不了（spec 決策 3）。
   */
  private async recordPayment(
    tx: Prisma.TransactionClient,
    userId: string,
    row: DebtRow,
    input: CreateDebtPaymentRequest,
    target: DebtRecordTarget,
  ): Promise<string> {
    await assertLedgerWritable(tx, userId, target.ledgerId);
    return this.transactions.createDebtTransaction(tx, {
      ledgerId: target.ledgerId,
      creatorId: userId,
      type: paymentTransactionType(row.direction),
      amount: input.amount,
      date: new Date(input.date),
      accountId: target.accountId,
    });
  }
}

/**
 * 決定這筆還款要記到哪裡（spec §5.1），`null` 代表不產生交易：
 *
 * 0. `record: null` 是使用者明說「這筆錢沒經過帳戶」，不產生交易。與「省略」分開，
 *    是因為省略會沿用本金交易，本金有交易的債務就沒有別的方法表達這件事（3b-1 修訂）。
 * 1. 有指定 `record` 就照指定的走——原帳本封存之後，還款仍要記得下去（決策 18）。
 * 2. 沒指定就沿用本金那筆交易的帳本與帳戶，這是絕大多數情況下使用者想要的。
 * 3. 本金本來就沒有交易（上線前就存在的舊債，決策 7），那還款也不產生交易。
 */
function resolveRecordTarget(
  row: DebtRow,
  record: DebtRecordTarget | null | undefined,
): DebtRecordTarget | null {
  if (record === null) {
    return null;
  }
  if (record !== undefined) {
    return record;
  }
  if (row.transaction === null) {
    return null;
  }
  return {
    ledgerId: row.transaction.ledgerId,
    accountId: row.transaction.accountId ?? undefined,
  };
}
