/* eslint-disable @typescript-eslint/no-unused-vars -- 骨架：實作時連同這一行一起移除 */
import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CreateDebtPaymentRequest, Debt } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

/**
 * 債務的還款與免除。規格見 `docs/specs/phase-3b-debts.md` §3.2、§5.1。
 *
 * TODO(T8)：由 worker 實作。方法簽章與回應形狀是 API 契約，不要改。
 */
@Injectable()
export class DebtPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /** 記一筆還款，回傳更新後的債務。 */
  create(_userId: string, _debtId: string, _input: CreateDebtPaymentRequest): Promise<Debt> {
    throw new NotImplementedException();
  }

  /** 軟刪除一筆還款與它的交易。 */
  remove(_userId: string, _debtId: string, _paymentId: string): Promise<void> {
    throw new NotImplementedException();
  }

  /** 免除剩餘金額，回傳更新後的債務。 */
  forgive(_userId: string, _debtId: string): Promise<Debt> {
    throw new NotImplementedException();
  }
}
