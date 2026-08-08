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

  // VIEWER is the floor so any member can remove *themselves* (leave);
  // removing someone else is checked in the service and requires OWNER.
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
