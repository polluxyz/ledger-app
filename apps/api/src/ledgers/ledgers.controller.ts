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
import { ApiBearerAuth, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  JwtPayload,
  LedgerDetail,
  LedgerSummary,
  LedgerRemovalPreview,
  LedgerLeavePreview,
} from '@ledger/shared';
import { LeaveLedgerDto } from './dto/leave-ledger.dto';
import { LedgerLeavePreviewDto } from './dto/ledger-leave-preview.dto';
import { LedgerLeaveService } from './ledger-leave.service';
import { AllowOnArchived } from '../common/decorators/allow-on-archived.decorator';
import { RemoveLedgerQueryDto } from './dto/remove-ledger-query.dto';
import { LedgerRemovalPreviewDto } from './dto/ledger-removal-preview.dto';
import { LedgerDetailDto } from './dto/ledger-detail.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { ListLedgersQueryDto } from './dto/list-ledgers-query.dto';
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
  constructor(
    private readonly ledgers: LedgersService,
    private readonly ledgerLeave: LedgerLeaveService,
  ) {}

  @Post(':ledgerId/leave-preview')
  @RequireLedgerRole('VIEWER')
  @AllowOnArchived()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, type: LedgerLeavePreviewDto })
  @ApiResponse({ status: 400, description: 'Invalid target or excluded items.' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient target ledger role or deletion permission.',
  })
  @ApiResponse({ status: 404, description: 'Source or target ledger not found.' })
  @ApiResponse({ status: 409, description: 'Target ledger is archived.' })
  leavePreview(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: LeaveLedgerDto,
  ): Promise<LedgerLeavePreview> {
    return this.ledgerLeave.preview(ledgerId, user.sub, dto);
  }

  @Post(':ledgerId/leave')
  @RequireLedgerRole('VIEWER')
  @AllowOnArchived()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Own records merged or withdrawn, membership removed.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid target, excluded items or ledger name confirmation.',
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient target ledger role or deletion permission.',
  })
  @ApiResponse({ status: 404, description: 'Source or target ledger not found.' })
  @ApiResponse({
    status: 409,
    description:
      'LEDGER_ARCHIVED, LEDGER_HAS_OTHER_MEMBERS, LEDGER_HAS_OTHERS_TRANSACTIONS or LAST_OWNER_CANNOT_LEAVE.',
  })
  leave(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: LeaveLedgerDto,
  ): Promise<void> {
    return this.ledgerLeave.leave(ledgerId, user.sub, dto);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLedgerDto): Promise<LedgerSummary> {
    return this.ledgers.create(user.sub, dto);
  }

  // 只回傳呼叫者自己所屬的帳本——資料隔離靠 service 以 user.sub 過濾達成。
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListLedgersQueryDto,
  ): Promise<LedgerSummary[]> {
    return this.ledgers.listForUser(user.sub, query.includeArchived);
  }

  @Get(':ledgerId')
  @RequireLedgerRole('VIEWER')
  detail(@Param('ledgerId') ledgerId: string): Promise<LedgerDetail> {
    return this.ledgers.getDetail(ledgerId);
  }

  @Patch(':ledgerId')
  @RequireLedgerRole('OWNER')
  rename(@Param('ledgerId') ledgerId: string, @Body() dto: UpdateLedgerDto): Promise<LedgerDetail> {
    return this.ledgers.rename(ledgerId, dto.name, dto.kind);
  }

  /**
   * 封存帳本：轉為唯讀並從預設清單中收起。這是結束一本帳本的正常途徑；
   * 刪除不影響別人的交易與帳戶；私人帳本可明確同意一併撤銷自己的借還。
   */
  @Post(':ledgerId/archive')
  @RequireLedgerRole('OWNER')
  archive(@Param('ledgerId') ledgerId: string): Promise<LedgerDetail> {
    return this.ledgers.archive(ledgerId);
  }

  @Post(':ledgerId/unarchive')
  @RequireLedgerRole('OWNER')
  @AllowOnArchived()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, type: LedgerDetailDto })
  @ApiResponse({ status: 403, description: 'Only an owner can unarchive.' })
  @ApiResponse({ status: 404, description: 'Ledger not found or caller is not a member.' })
  @ApiResponse({ status: 409, description: 'LEDGER_NOT_ARCHIVED' })
  unarchive(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<LedgerDetail> {
    return this.ledgers.unarchive(ledgerId, user.sub);
  }

  @Get(':ledgerId/removal-preview')
  @RequireLedgerRole('OWNER')
  @ApiResponse({ status: 200, type: LedgerRemovalPreviewDto })
  @ApiResponse({ status: 403, description: 'Only an owner can preview deletion.' })
  @ApiResponse({ status: 404, description: 'Ledger not found or caller is not a member.' })
  removalPreview(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<LedgerRemovalPreview> {
    return this.ledgers.removalPreview(ledgerId, user.sub);
  }

  @Delete(':ledgerId')
  @RequireLedgerRole('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'confirm', description: 'Must equal the ledger name.' })
  @ApiQuery({
    name: 'withdrawDebts',
    required: false,
    type: Boolean,
    description: 'Explicitly consent to withdrawing personal ledger debts and splits.',
  })
  @ApiResponse({ status: 204, description: 'Ledger deleted; debt history retained.' })
  @ApiResponse({ status: 400, description: 'Invalid query or ledger name confirmation.' })
  @ApiResponse({ status: 403, description: 'Only an owner can delete.' })
  @ApiResponse({ status: 404, description: 'Ledger not found or caller is not a member.' })
  @ApiResponse({
    status: 409,
    description:
      'LEDGER_ARCHIVED, LEDGER_HAS_OTHERS_TRANSACTIONS, LEDGER_HAS_DEBT_TRANSACTIONS or DEBT_WITHDRAWAL_REQUIRED.',
  })
  remove(
    @Param('ledgerId') ledgerId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: RemoveLedgerQueryDto,
  ): Promise<void> {
    return this.ledgers.remove(ledgerId, user.sub, query.confirm, query.withdrawDebts);
  }
}
