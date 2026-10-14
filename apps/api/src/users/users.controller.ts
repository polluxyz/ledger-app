import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser, JwtPayload, RecordDefaults } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RecordDefaultsQueryDto } from './dto/record-defaults-query.dto';
import { RecordDefaultsResponseDto } from './dto/record-defaults-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * 個人資料端點。只操作「自己」——目標使用者一律取自 JWT（`user.sub`），
 * 而非路徑或 body 參數，因此不可能藉由改 id 去讀寫別人的資料。
 */
@ApiTags('users')
@ApiBearerAuth('jwt')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload): Promise<AuthUser> {
    return this.usersService.getById(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto): Promise<AuthUser> {
    return this.usersService.updateName(user.sub, dto.name);
  }

  @Get('me/record-defaults')
  @ApiOkResponse({ type: RecordDefaultsResponseDto })
  getRecordDefaults(
    @CurrentUser() user: JwtPayload,
    @Query() query: RecordDefaultsQueryDto,
  ): Promise<RecordDefaults> {
    return this.usersService.getRecordDefaults(user.sub, query.ledgerId);
  }
}
