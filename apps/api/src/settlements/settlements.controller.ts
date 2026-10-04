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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, SettlementSummary, Transaction } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { SetSettlementAccountDto } from './dto/set-settlement-account.dto';
import { UpdateSettlementDto } from './dto/update-settlement.dto';
import { SettlementsService } from './settlements.service';

/**
 * 結清檢視與結清交易的 HTTP 入口。路由固定在帳本之下，授權由共用 guard 檢查；
 * service 再確認帳本類型與結清 id 的歸屬。
 */
@ApiTags('settlements')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('settlement-summary')
  @RequireLedgerRole('VIEWER')
  summary(@Param('ledgerId') ledgerId: string): Promise<SettlementSummary> {
    return this.settlements.summary(ledgerId);
  }

  @Post('settlements')
  @RequireLedgerRole('EDITOR')
  create(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSettlementDto,
  ): Promise<Transaction> {
    return this.settlements.create(ledgerId, user.sub, dto);
  }

  @Patch('settlements/:settlementId')
  @RequireLedgerRole('EDITOR')
  update(
    @Param('ledgerId') ledgerId: string,
    @Param('settlementId') settlementId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSettlementDto,
  ): Promise<Transaction> {
    return this.settlements.update(ledgerId, settlementId, user.sub, dto);
  }

  @Delete('settlements/:settlementId')
  @RequireLedgerRole('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('ledgerId') ledgerId: string,
    @Param('settlementId') settlementId: string,
  ): Promise<void> {
    return this.settlements.remove(ledgerId, settlementId);
  }

  @Put('settlements/:settlementId/account')
  @RequireLedgerRole('VIEWER')
  setAccount(
    @Param('ledgerId') ledgerId: string,
    @Param('settlementId') settlementId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetSettlementAccountDto,
  ): Promise<Transaction> {
    return this.settlements.setAccount(ledgerId, settlementId, user.sub, dto.accountId);
  }
}
