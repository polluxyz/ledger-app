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

@ApiTags('transactions')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

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
