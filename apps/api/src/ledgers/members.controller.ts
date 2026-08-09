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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerMemberInfo } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { LedgerAccessGuard } from './guards/ledger-access.guard';
import { LedgersService } from './ledgers.service';

/**
 * 帳本成員管理，巢狀在 `/ledgers/:ledgerId/members`。查看成員需 VIEWER；
 * 加入／改角色需 OWNER。刪除較特別（見下方 remove）——門檻設 VIEWER，
 * 好讓任何成員都能退出，是否能移除「他人」則由 service 進一步判斷。
 */
@ApiTags('ledger-members')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/members')
export class MembersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Get()
  @RequireLedgerRole('VIEWER')
  list(@Param('ledgerId') ledgerId: string): Promise<LedgerMemberInfo[]> {
    return this.ledgers.listMembers(ledgerId);
  }

  @Post()
  @RequireLedgerRole('OWNER')
  add(@Param('ledgerId') ledgerId: string, @Body() dto: AddMemberDto): Promise<LedgerMemberInfo> {
    return this.ledgers.addMember(ledgerId, dto.email, dto.role);
  }

  @Patch(':userId')
  @RequireLedgerRole('OWNER')
  updateRole(
    @Param('ledgerId') ledgerId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<LedgerMemberInfo> {
    return this.ledgers.updateMemberRole(ledgerId, userId, dto.role);
  }

  // 門檻設 VIEWER，讓任何成員都能移除「自己」（退出）；移除他人則在 service
  // 內另行檢查，需 OWNER。
  @Delete(':userId')
  @RequireLedgerRole('VIEWER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('ledgerId') ledgerId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.ledgers.removeMember(ledgerId, userId, user.sub);
  }
}
