import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, Paginated, Transaction } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

/**
 * 交易資源的 HTTP 進入點。路由巢狀在 `/ledgers/:ledgerId/transactions` 底下，
 * 因此「交易屬於哪個帳本」永遠是 URL 的一部分——沒有辦法不指名帳本就操作交易。
 *
 * controller 刻意保持「薄」：只負責驗證輸入（交給 DTO）、把關存取權限，
 * 業務邏輯全部委派給 TransactionsService。
 *
 * 每個路由都會跑兩層 guard（預設拒絕的授權模型）：
 *   1. 全域 JWT guard 已先完成身分驗證，並把 user 掛到 request 上。
 *   2. `@UseGuards(LedgerAccessGuard)` + `@RequireLedgerRole(...)` 檢查這位已驗證
 *      的使用者是否為 `:ledgerId` 的成員、且角色達到門檻。非成員回 404
 *      （我們絕不確認該帳本是否存在）；角色不足的成員回 403。
 */
@ApiTags('transactions')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  // 讀取只需 VIEWER；寫入（新增／更新／刪除）需要 EDITOR。
  @Get()
  @RequireLedgerRole('VIEWER')
  list(
    @Param('ledgerId') ledgerId: string,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Paginated<Transaction>> {
    return this.transactions.list(ledgerId, query);
  }

  @Post()
  @RequireLedgerRole('EDITOR')
  create(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransactionDto,
  ): Promise<Transaction> {
    // `user.sub` 是 JWT 的 subject＝已驗證使用者的 id，會被記為交易的建立者。
    // 我們絕不採信 body 裡傳來的 creator id。
    return this.transactions.create(ledgerId, user.sub, dto);
  }

  @Get(':transactionId')
  @RequireLedgerRole('VIEWER')
  detail(
    @Param('ledgerId') ledgerId: string,
    @Param('transactionId') transactionId: string,
  ): Promise<Transaction> {
    return this.transactions.getById(ledgerId, transactionId);
  }

  @Patch(':transactionId')
  @RequireLedgerRole('EDITOR')
  update(
    @Param('ledgerId') ledgerId: string,
    @Param('transactionId') transactionId: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<Transaction> {
    return this.transactions.update(ledgerId, transactionId, dto);
  }

  // 軟刪除：成功時回 204 No Content（空 body）。資料列仍保留在資料庫，只是被
  // 設上 `deletedAt`——詳見 TransactionsService.remove。
  @Delete(':transactionId')
  @RequireLedgerRole('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('ledgerId') ledgerId: string,
    @Param('transactionId') transactionId: string,
  ): Promise<void> {
    return this.transactions.remove(ledgerId, transactionId);
  }
}
