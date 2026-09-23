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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Debt, DebtSummary, JwtPayload, Paginated } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DebtsService } from './debts.service';
import { CreateDebtDto } from './dto/create-debt.dto';
import { ListDebtsQueryDto } from './dto/list-debts-query.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';

/**
 * 我的債務。債務屬於使用者、不屬於帳本（spec 決策 17），所以不在 `/ledgers/{id}` 之下，
 * 也不套 `LedgerAccessGuard`。
 *
 * 授權在 service：債務只有擁有者看得到，其他人一律 404。把交易記進帳本時的帳本權限，
 * 由 service 用 `assertLedgerWritable` 做與 guard 相同的檢查。
 */
@ApiTags('debts')
@ApiBearerAuth('jwt')
@Controller('debts')
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Post()
  @ApiNotFoundResponse({ description: 'The ledger or account in `record` is not accessible.' })
  @ApiForbiddenResponse({ description: 'The caller is only a VIEWER of the ledger in `record`.' })
  @ApiConflictResponse({ description: 'LEDGER_ARCHIVED.' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDebtDto): Promise<Debt> {
    return this.debts.create(user.sub, dto);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDebtsQueryDto,
  ): Promise<Paginated<Debt>> {
    return this.debts.list(user.sub, query);
  }

  // 宣告在 `:id` 之前，否則 "summary" 會被當成債務 id。
  @Get('summary')
  summary(@CurrentUser() user: JwtPayload): Promise<DebtSummary> {
    return this.debts.summary(user.sub);
  }

  @Get(':id')
  @ApiNotFoundResponse({ description: 'No such debt, or it is not yours.' })
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<Debt> {
    return this.debts.get(user.sub, id);
  }

  @Patch(':id')
  @ApiNotFoundResponse({ description: 'No such debt, or it is not yours.' })
  @ApiConflictResponse({ description: 'DEBT_OVERPAYMENT: principal below the total repaid.' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDebtDto,
  ): Promise<Debt> {
    return this.debts.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'No such debt, or it is not yours.' })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.debts.remove(user.sub, id);
  }
}
