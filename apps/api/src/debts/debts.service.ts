/* eslint-disable @typescript-eslint/no-unused-vars -- 骨架：實作時連同這一行一起移除 */
import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CreateDebtRequest,
  Debt,
  DebtSummary,
  ListDebtsQuery,
  Paginated,
  UpdateDebtRequest,
} from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

/**
 * 債務本身：建立、列表、單筆、修改、刪除、每人淨額。規格見 `docs/specs/phase-3b-debts.md`
 * §3、§5.1、§5.4。還款與免除在 `DebtPaymentsService`。
 *
 * TODO(T7)：由 worker 實作。方法簽章與回應形狀是 API 契約，不要改。
 */
@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  create(_userId: string, _input: CreateDebtRequest): Promise<Debt> {
    throw new NotImplementedException();
  }

  list(_userId: string, _query: ListDebtsQuery): Promise<Paginated<Debt>> {
    throw new NotImplementedException();
  }

  get(_userId: string, _debtId: string): Promise<Debt> {
    throw new NotImplementedException();
  }

  update(_userId: string, _debtId: string, _input: UpdateDebtRequest): Promise<Debt> {
    throw new NotImplementedException();
  }

  remove(_userId: string, _debtId: string): Promise<void> {
    throw new NotImplementedException();
  }

  summary(_userId: string): Promise<DebtSummary> {
    throw new NotImplementedException();
  }
}
