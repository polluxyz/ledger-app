import { Injectable } from '@nestjs/common';
import type {
  CreateDebtRequest,
  Debt,
  DebtSummary,
  DebtSummaryItem,
  ListDebtsQuery,
  Paginated,
  UpdateDebtRequest,
} from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import {
  DEBT_INCLUDE,
  computeDebtState,
  debtNotOpen,
  debtOverpayment,
  hasActiveSettlement,
  loadOwnedDebt,
  paidTotal,
  principalTransactionType,
  toDebt,
} from './debt-state';

/**
 * 債務本身：建立、列表、單筆、修改、刪除、每人淨額。規格見 `docs/specs/phase-3b-debts.md`
 * §3、§5.1、§5.4。還款與免除在 `DebtPaymentsService`。
 *
 * 三條貫穿全檔的規則：
 * - **授權一律走共用函式**。讀單筆用 `loadOwnedDebt`（不是自己的就 404）；要把交易記進
 *   帳本則用 `assertLedgerWritable`。債務端點不在 `/ledgers/{id}` 之下，`LedgerAccessGuard`
 *   看不到 body 裡的帳本 id，所以檢查落在 service。
 * - **會同時動到債務與交易的操作，整段包在同一個 `$transaction` 裡**。中途失敗必須什麼都
 *   沒寫：只建了交易卻沒建債務，那筆錢就會從帳戶消失而且沒有任何線索指回來。
 * - **未清餘額與狀態是算出來的**（決策 5），一律經過 `computeDebtState`，不存欄位。
 */

// 分頁預設值與每頁上限，與交易列表一致；超過上限夾住，不報錯。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /**
   * 建立一筆債務。帶 `record` 就一併產生本金交易（`LENT` → `LEND`，`BORROWED` → `BORROW`）；
   * 不帶就只有債務記錄，用於系統上線前就存在的舊債（決策 7）。
   *
   * 順序是「先檢查帳本、再寫交易、最後寫債務」：帳本權限不足時交易根本不會被建立，
   * 而整段在同一個資料庫交易裡，任何一步丟例外都會整個回滾。
   */
  async create(userId: string, input: CreateDebtRequest): Promise<Debt> {
    const row = await this.prisma.$transaction(async (tx) => {
      let transactionId: string | null = null;

      if (input.record !== undefined) {
        await assertLedgerWritable(tx, userId, input.record.ledgerId);
        transactionId = await this.transactions.createDebtTransaction(tx, {
          ledgerId: input.record.ledgerId,
          creatorId: userId,
          type: principalTransactionType(input.direction),
          amount: input.principal,
          date: new Date(input.date),
          accountId: input.record.accountId,
        });
      }

      return tx.debt.create({
        data: {
          ownerId: userId,
          direction: input.direction,
          counterpartyName: input.counterpartyName,
          principal: input.principal,
          date: new Date(input.date),
          note: input.note ?? null,
          transactionId,
        },
        include: DEBT_INCLUDE,
      });
    });

    return toDebt(row);
  }

  /**
   * 我的債務清單，日期由新到舊。
   *
   * 狀態是算出來的、不是欄位，所以 `status` 篩選沒辦法交給資料庫：先撈出自己全部未刪除的
   * 債務，逐筆算狀態、篩完再切頁。這是刻意的取捨——存一個 status 欄位確實可以下推到 SQL，
   * 但決策 5 明白禁止（只要有一條路徑忘了更新它就會永遠錯下去），而單一使用者的債務筆數
   * 很小，全部載進記憶體的代價可以接受。
   */
  async list(userId: string, query: ListDebtsQuery): Promise<Paginated<Debt>> {
    const page = Math.max(query.page ?? DEFAULT_PAGE, 1);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const rows = await this.prisma.debt.findMany({
      where: { ownerId: userId, deletedAt: null },
      include: DEBT_INCLUDE,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const matched =
      query.status === undefined
        ? rows
        : rows.filter((row) => computeDebtState(row).status === query.status);

    return {
      items: matched.slice((page - 1) * limit, page * limit).map(toDebt),
      page,
      limit,
      total: matched.length,
    };
  }

  async get(userId: string, debtId: string): Promise<Debt> {
    return toDebt(await loadOwnedDebt(this.prisma, userId, debtId));
  }

  /**
   * 修改債務。只有送出的欄位會變；`note` 送 `null` 表示清除備註。
   *
   * 任何狀態都可以改：spec §3.2 那張表限制的是記還款與免除，那兩件事在 `DebtPaymentsService`。
   * 唯一的例外是**以結清還款結清的債務不能改本金**（決策 30）：差額由本金算出，本金一改，
   * 已經談定的差額就會默默變掉。要改得先刪掉那筆結清還款。送回相同的本金不算改。
   *
   * 本金改小到低於已還總額 → `409 DEBT_OVERPAYMENT`，且什麼都不寫。本金或日期變了，本金
   * 那筆交易要跟著改，否則帳戶餘額會和債務對不起來——所以連同檢查一起放在同一個
   * `$transaction`，避免「債務改好了、交易沒改」這種半套狀態。
   */
  async update(userId: string, debtId: string, input: UpdateDebtRequest): Promise<Debt> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedDebt(tx, userId, debtId);

      const newPrincipal = input.principal;
      const principalChanges = newPrincipal !== undefined && newPrincipal !== existing.principal;
      if (principalChanges && hasActiveSettlement(existing.payments)) {
        throw debtNotOpen();
      }
      // 只在本金真的改變時檢查：結清時多收的債務，已還總額本來就大於本金。
      if (principalChanges && newPrincipal < paidTotal(existing.payments)) {
        throw debtOverpayment();
      }

      const date = input.date === undefined ? undefined : new Date(input.date);
      const updated = await tx.debt.update({
        where: { id: debtId },
        data: {
          ...(input.counterpartyName !== undefined
            ? { counterpartyName: input.counterpartyName }
            : {}),
          ...(input.principal !== undefined ? { principal: input.principal } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        include: DEBT_INCLUDE,
      });

      const amountChanged = input.principal !== undefined && input.principal !== existing.principal;
      const dateChanged = date !== undefined && date.getTime() !== existing.date.getTime();

      if (existing.transactionId !== null && (amountChanged || dateChanged)) {
        await this.transactions.updateDebtTransaction(tx, existing.transactionId, {
          ...(amountChanged ? { amount: input.principal } : {}),
          ...(dateChanged ? { date } : {}),
        });
      }

      return updated;
    });

    return toDebt(row);
  }

  /**
   * 軟刪除一筆債務：債務本身、它所有還沒被刪的還款，以及本金與還款對應的交易，全部標上
   * 同一個 `deletedAt`。用同一個時間戳，是為了日後稽核時一眼看出這些列是同一次刪除。
   *
   * 交易一起刪，帳戶餘額才會回到建立這筆債務之前（SC-D7）。
   */
  async remove(userId: string, debtId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await loadOwnedDebt(tx, userId, debtId);
      const deletedAt = new Date();

      const transactionIds = [
        existing.transactionId,
        ...existing.payments
          .filter((payment) => payment.deletedAt === null)
          .map((payment) => payment.transactionId),
      ].filter((id): id is string => id !== null);

      await tx.debt.update({ where: { id: debtId }, data: { deletedAt } });
      await tx.debtPayment.updateMany({
        where: { debtId, deletedAt: null },
        data: { deletedAt },
      });
      await this.transactions.softDeleteDebtTransactions(tx, transactionIds, deletedAt);
    });
  }

  /**
   * 每人淨額（spec §5.4）：正數代表對方欠我，負數代表我欠對方。
   *
   * 只計 `OPEN` 的債務——已結清沒有餘額，已免除的錢則是決定不收了，兩者都不該再出現在
   * 「誰欠誰」這張表上。分組鍵是**完全相同的名字字串**：3b-1 的債務都是單邊記錄，系統
   * 無從得知兩筆寫著同樣名字的記錄是不是同一個人，只能照字面比對，所以
   * `counterpartyUserId` 一律是 `null`（連動要到 3b-2 才有）。
   *
   * 淨額剛好為 0 的人（借出與借入互相抵銷）整列略去，那等於兩不相欠。
   */
  async summary(userId: string): Promise<DebtSummary> {
    const rows = await this.prisma.debt.findMany({
      where: { ownerId: userId, deletedAt: null },
      include: { payments: true },
    });

    const netByName = new Map<string, number>();
    for (const row of rows) {
      const { outstanding, status } = computeDebtState(row);
      if (status !== 'OPEN') {
        continue;
      }
      const signed = row.direction === 'LENT' ? outstanding : -outstanding;
      netByName.set(row.counterpartyName, (netByName.get(row.counterpartyName) ?? 0) + signed);
    }

    const items: DebtSummaryItem[] = [...netByName.entries()]
      .filter(([, net]) => net !== 0)
      .map(([counterpartyName, net]) => ({ counterpartyName, counterpartyUserId: null, net }))
      .sort((a, b) => (a.counterpartyName < b.counterpartyName ? -1 : 1));

    return { items };
  }
}
