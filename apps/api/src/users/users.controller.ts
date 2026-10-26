import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser, JwtPayload, RecordDefaults } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RecordDefaultsQueryDto } from './dto/record-defaults-query.dto';
import { RecordDefaultsResponseDto } from './dto/record-defaults-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { HomeLayoutService } from './home-layout.service';
import { HomeLayoutBodyGuard } from './home-layout-body.guard';
import { PutHomeLayoutDto } from './dto/put-home-layout.dto';
import { HomeLayoutResponseDto } from './dto/home-layout-response.dto';

/**
 * 個人資料端點。只操作「自己」——目標使用者一律取自 JWT（`user.sub`），
 * 而非路徑或 body 參數，因此不可能藉由改 id 去讀寫別人的資料。
 * 首頁版面（2l）也在這裡：GET／PUT `me/home-layout/web`，以 revision 偵測同時編輯；
 * PUT 先經 `HomeLayoutBodyGuard` 擋禁用鍵，版面內容交給 `HomeLayoutService` 驗證。
 */
@ApiTags('users')
@ApiBearerAuth('jwt')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly homeLayoutService: HomeLayoutService,
  ) {}

  @Get('me/home-layout/web')
  @ApiOkResponse({ type: HomeLayoutResponseDto })
  getHomeLayout(@CurrentUser() user: JwtPayload): Promise<HomeLayoutResponseDto> {
    return this.homeLayoutService.get(user.sub);
  }

  @Put('me/home-layout/web')
  @UseGuards(HomeLayoutBodyGuard)
  @ApiOkResponse({ type: HomeLayoutResponseDto })
  putHomeLayout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PutHomeLayoutDto,
  ): Promise<HomeLayoutResponseDto> {
    return this.homeLayoutService.put(user.sub, dto);
  }

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
