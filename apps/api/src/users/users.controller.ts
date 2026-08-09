import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser, JwtPayload } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
}
