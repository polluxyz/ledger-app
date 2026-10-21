import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, MarkedTransaction, Paginated } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ListMarkedTransactionsQueryDto } from './dto/list-marked-transactions-query.dto';
import { PaginatedMarkedTransactionDto } from './dto/marked-transaction-response.dto';
import { TransactionsService } from './transactions.service';

/** 跨帳本的本人標註入口；成員範圍由 service 的資料庫查詢限制。 */
@ApiTags('transactions')
@ApiBearerAuth('jwt')
@Controller('transactions')
export class MarkedTransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get('marked')
  @ApiOkResponse({ type: PaginatedMarkedTransactionDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListMarkedTransactionsQueryDto,
  ): Promise<Paginated<MarkedTransaction>> {
    return this.transactions.listMarked(user.sub, query);
  }
}
