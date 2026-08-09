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
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerDetail, LedgerSummary } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateLedgerDto } from './dto/update-ledger.dto';
import { LedgerAccessGuard } from './guards/ledger-access.guard';
import { LedgersService } from './ledgers.service';

/**
 * 帳本本身的 CRUD。此 controller 掛了 LedgerAccessGuard，但只有標了
 * @RequireLedgerRole 的路由才真的做角色檢查：
 *   - create／list 不標——建立時還沒有帳本可檢查；列表只回「你自己是成員」的
 *     帳本（由 service 依 user.sub 過濾），本身就是隔離的。
 *   - detail 需 VIEWER；rename／remove 需 OWNER。
 */
@ApiTags('ledgers')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers')
export class LedgersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLedgerDto): Promise<LedgerSummary> {
    return this.ledgers.create(user.sub, dto.name);
  }

  // 只回傳呼叫者自己所屬的帳本——資料隔離靠 service 以 user.sub 過濾達成。
  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<LedgerSummary[]> {
    return this.ledgers.listForUser(user.sub);
  }

  @Get(':ledgerId')
  @RequireLedgerRole('VIEWER')
  detail(@Param('ledgerId') ledgerId: string): Promise<LedgerDetail> {
    return this.ledgers.getDetail(ledgerId);
  }

  @Patch(':ledgerId')
  @RequireLedgerRole('OWNER')
  rename(@Param('ledgerId') ledgerId: string, @Body() dto: UpdateLedgerDto): Promise<LedgerDetail> {
    return this.ledgers.rename(ledgerId, dto.name);
  }

  @Delete(':ledgerId')
  @RequireLedgerRole('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'confirm', description: 'Must equal the ledger name.' })
  remove(@Param('ledgerId') ledgerId: string, @Query('confirm') confirm: string): Promise<void> {
    return this.ledgers.remove(ledgerId, confirm);
  }
}
