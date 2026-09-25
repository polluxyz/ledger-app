import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type {
  DebtEntryRecordTarget,
  DebtProposal,
  ListDebtProposalsQuery,
  Paginated,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { findLinkBetween, ownSideCounterparty } from './counterparty-links';
import {
  badRequest,
  currentBalance,
  deltaFor,
  lockCounterparty,
  notFound,
  resolveRepayment,
} from './debt-entry-rules';
import { PROPOSAL_INCLUDE, mirrorKind, toDebtProposal } from './debt-proposal-rules';
import { recordDebtTransaction, writeSettlement } from './debt-recording';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ProposalRow = Prisma.DebtProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

/** 接受「新增」時需要帳本與帳戶的種類：會產生交易的四種。免除只改往來餘額。 */
const RECORDABLE_KINDS = new Set(['LEND', 'BORROW', 'COLLECT', 'REPAY']);

/**
 * 提議：列出、接受、拒絕。規格見 `docs/specs/phase-3b2-linking.md` §3.2、§3.3、§5.3。
 *
 * **接受是本專案唯一「因為別人的動作而寫進我的帳」的路徑**，所以三條規則不能鬆：
 * 1. 只有接受者本人能接受或拒絕；發起者 403，其他人 404（不讓外人知道提議存在）。
 * 2. 寫入時的帳本、帳戶檢查一律以**接受者**的身分做，與他自己記帳完全相同。
 * 3. 以接受者**自己的餘額**檢查還款與結清（決策 65）：雙方餘額可能不同（連動前的紀錄不同步），
 *    不能拿發起者的數字寫進接受者的帳。
 *
 * 狀態轉換用條件式更新（`status: 'PENDING'` 當條件），並且放在同一個資料庫交易的最前面：
 * 兩次接受同時送達時只有一次拿得到 `count = 1`；之後任何一步失敗，整筆回滾，提議回到
 * `PENDING`，接受者可以改用別的帳戶再試，或改成拒絕。
 */
@Injectable()
export class DebtProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /**
   * 收到的或送出的提議，新到舊。`direction` 決定用哪一個欄位比對呼叫者，所以查詢天生限定在
   * 呼叫者自己的提議。
   */
  async list(userId: string, query: ListDebtProposalsQuery): Promise<Paginated<DebtProposal>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where: Prisma.DebtProposalWhereInput = {
      ...(query.direction === 'incoming' ? { toUserId: userId } : { fromUserId: userId }),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.debtProposal.findMany({
        where,
        include: PROPOSAL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.debtProposal.count({ where }),
    ]);

    return {
      items: await Promise.all(rows.map((row) => this.present(this.prisma, row, userId))),
      page,
      limit,
      total,
    };
  }

  /** 接受（§3.3）。`record` 只有會產生交易的「新增」要帶，其餘不可帶。 */
  async accept(
    userId: string,
    proposalId: string,
    record: DebtEntryRecordTarget | null | undefined,
  ): Promise<DebtProposal> {
    const row = await this.loadForAction(userId, proposalId);
    const needsRecord = row.type === 'CREATE' && RECORDABLE_KINDS.has(row.entryKind);
    if (needsRecord && record === undefined) {
      throw badRequest('record is required: an object to record a transaction, or null for none.');
    }
    if (!needsRecord && record !== undefined) {
      throw badRequest('record is only valid when accepting a new loan or repayment.');
    }

    return this.prisma.$transaction(async (tx) => {
      const respondedAt = new Date();
      await this.claim(tx, row.id, 'ACCEPTED', respondedAt);

      // 解除連動會作廢所有待確認的提議，所以這裡一定找得到連動；找不到代表兩邊狀態不一致，
      // 當成「已經不是待確認」處理，不寫任何東西。
      const link = await findLinkBetween(tx, row.fromUserId, row.toUserId);
      if (link === null) {
        throw notPending();
      }
      const counterpartyId = ownSideCounterparty(link, userId);
      await lockCounterparty(tx, counterpartyId);

      if (row.type === 'CREATE') {
        await this.acceptCreate(tx, row, userId, counterpartyId, record ?? null);
      } else if (row.type === 'AMEND') {
        await this.acceptAmend(tx, row, counterpartyId);
      } else {
        await this.acceptDelete(tx, row, counterpartyId, respondedAt);
      }

      return this.present(tx, { ...row, status: 'ACCEPTED', respondedAt }, userId);
    });
  }

  /** 拒絕。對方那筆保留，標示「對方未接受」（決策 66）；系統不重送。 */
  async decline(userId: string, proposalId: string): Promise<DebtProposal> {
    const row = await this.loadForAction(userId, proposalId);
    return this.prisma.$transaction(async (tx) => {
      const respondedAt = new Date();
      await this.claim(tx, row.id, 'DECLINED', respondedAt);
      return this.present(tx, { ...row, status: 'DECLINED', respondedAt }, userId);
    });
  }

  /**
   * 接受「新增」（§3.2）：在接受者的帳寫一筆方向相反的紀錄，並與發起者那筆互相配對。
   *
   * - 借出、借入：照對照表寫，可以產生交易。
   * - 還款：方向已由發起者那筆決定，這裡以接受者的餘額檢查。`resolveRepayment` 算出的方向與
   *   對照表不同，代表接受者的帳上是反方向的欠款（例如他記的是對方欠他），這筆還款在他的帳上
   *   沒有東西可還，回 `NOTHING_TO_REPAY`。
   * - 免除：接受者欠對方時寫一筆 `FORGIVEN` 讓餘額歸零；沒有欠款就照樣接受、什麼都不寫。
   */
  private async acceptCreate(
    tx: Prisma.TransactionClient,
    row: ProposalRow,
    userId: string,
    counterpartyId: string,
    record: DebtEntryRecordTarget | null,
  ): Promise<void> {
    const kind = mirrorKind(row.entryKind);

    if (kind === 'FORGIVEN') {
      const balance = await currentBalance(tx, counterpartyId);
      if (balance >= 0) {
        return;
      }
      const entry = await tx.debtEntry.create({
        data: {
          counterpartyId,
          kind: 'FORGIVEN',
          delta: -balance,
          date: row.date,
          note: null,
          transactionId: null,
        },
      });
      await this.pair(tx, row.sourceEntryId, entry.id);
      return;
    }

    if (kind !== 'LEND' && kind !== 'BORROW' && kind !== 'COLLECT' && kind !== 'REPAY') {
      // 送出端只會對上面這幾種建立提議（SYNCED_ENTRY_KINDS），走到這裡是資料不一致。
      throw notPending();
    }

    if (kind === 'COLLECT' || kind === 'REPAY') {
      const direction = resolveRepayment(
        await currentBalance(tx, counterpartyId),
        row.amount,
        row.settle,
      );
      if (direction !== kind) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.NOTHING_TO_REPAY,
          'Your own records show no debt in this direction to repay.',
        );
      }
    }

    const transactionId = await recordDebtTransaction(tx, this.transactions, {
      userId,
      record,
      kind,
      amount: row.amount,
      date: row.date,
    });
    const entry = await tx.debtEntry.create({
      data: {
        counterpartyId,
        kind,
        delta: deltaFor(kind, row.amount),
        date: row.date,
        note: null,
        transactionId,
      },
    });
    await this.pair(tx, row.sourceEntryId, entry.id);

    if (row.settle && (kind === 'COLLECT' || kind === 'REPAY')) {
      await writeSettlement(tx, counterpartyId, entry);
    }
  }

  /**
   * 接受「改金額或日期」：把接受者那筆改成提議的值，交易一起改。那筆已經被接受者自己刪掉、
   * 或不再在這個連動的對象底下，就照樣接受、什麼都不改（§3.3）。
   */
  private async acceptAmend(
    tx: Prisma.TransactionClient,
    row: ProposalRow,
    counterpartyId: string,
  ): Promise<void> {
    const target = await this.loadTarget(tx, row, counterpartyId);
    if (target === null) {
      return;
    }
    await tx.debtEntry.update({
      where: { id: target.id },
      data: { delta: Math.sign(target.delta) * row.amount, date: row.date },
    });
    if (target.transactionId !== null) {
      await this.transactions.updateDebtTransaction(tx, target.transactionId, {
        amount: row.amount,
        date: row.date,
      });
    }
  }

  /** 接受「刪除」：軟刪除接受者那筆與它的交易。配對在發起者刪除時就已清空。 */
  private async acceptDelete(
    tx: Prisma.TransactionClient,
    row: ProposalRow,
    counterpartyId: string,
    deletedAt: Date,
  ): Promise<void> {
    const target = await this.loadTarget(tx, row, counterpartyId);
    if (target === null) {
      return;
    }
    await tx.debtEntry.update({ where: { id: target.id }, data: { deletedAt } });
    await this.transactions.softDeleteDebtTransactions(
      tx,
      target.transactionId === null ? [] : [target.transactionId],
      deletedAt,
    );
  }

  /** 提議的目標：必須還沒刪、而且就在接受者這個連動的對象底下。 */
  private async loadTarget(tx: Prisma.TransactionClient, row: ProposalRow, counterpartyId: string) {
    if (row.targetEntryId === null) {
      return null;
    }
    return tx.debtEntry.findFirst({
      where: { id: row.targetEntryId, counterpartyId, deletedAt: null },
    });
  }

  /** 兩筆互相配對。雙向各存一次，同一個資料庫交易裡寫入。 */
  private async pair(tx: Prisma.TransactionClient, a: string, b: string): Promise<void> {
    await tx.debtEntry.update({ where: { id: a }, data: { pairedEntryId: b } });
    await tx.debtEntry.update({ where: { id: b }, data: { pairedEntryId: a } });
  }

  /**
   * 讀出提議並檢查呼叫者能不能回應。順序同好友邀請：外人 404 → 發起者 403 → 狀態 409。
   * 角色檢查排在狀態之前，否則發起者可以藉由 409 得知對方已經回應了什麼。
   */
  private async loadForAction(userId: string, proposalId: string): Promise<ProposalRow> {
    const row = await this.prisma.debtProposal.findUnique({
      where: { id: proposalId },
      include: PROPOSAL_INCLUDE,
    });
    if (row === null || (row.fromUserId !== userId && row.toUserId !== userId)) {
      throw notFound('Proposal');
    }
    if (row.toUserId !== userId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only the recipient can respond to this proposal.',
      );
    }
    if (row.status !== 'PENDING') {
      throw notPending();
    }
    return row;
  }

  /** 條件式地把提議從 `PENDING` 推進到終點；別的請求先改掉了就回 409。 */
  private async claim(
    tx: Prisma.TransactionClient,
    proposalId: string,
    status: 'ACCEPTED' | 'DECLINED',
    respondedAt: Date,
  ): Promise<void> {
    const updated = await tx.debtProposal.updateMany({
      where: { id: proposalId, status: 'PENDING' },
      data: { status, respondedAt },
    });
    if (updated.count === 0) {
      throw notPending();
    }
  }

  /** 轉成回應：`counterpartyId` 是呼叫者自己這邊連動的對象（解除後為 null）。 */
  private async present(
    client: Pick<Prisma.TransactionClient, 'counterpartyLink'>,
    row: ProposalRow,
    viewerId: string,
  ): Promise<DebtProposal> {
    const link = await findLinkBetween(client, row.fromUserId, row.toUserId);
    return toDebtProposal(
      row,
      viewerId,
      link === null ? null : ownSideCounterparty(link, viewerId),
    );
  }
}

function notPending(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.PROPOSAL_NOT_PENDING,
    'This proposal has already been answered or withdrawn.',
  );
}
