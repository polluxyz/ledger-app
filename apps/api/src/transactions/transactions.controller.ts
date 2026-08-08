import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, Transaction } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

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
}
