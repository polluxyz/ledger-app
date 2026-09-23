import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import type { Friend, JwtPayload, Paginated } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ListFriendsQueryDto } from './dto/list-friends-query.dto';
import { FriendsService } from './friends.service';

/**
 * 我的好友清單與解除好友。
 *
 * 沒有任何端點接受「別人的使用者 ID」來查清單：讀取對方的好友清單在結構上就不存在
 * （spec §3.3，SEC-19）。`DELETE /friends/{userId}` 的 userId 是「要解除的那位好友」，
 * 操作的仍然是我自己的關係。
 */
@ApiTags('friends')
@ApiBearerAuth('jwt')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListFriendsQueryDto,
  ): Promise<Paginated<Friend>> {
    return this.friends.list(user.sub, query);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'That user is not your friend.' })
  remove(@CurrentUser() user: JwtPayload, @Param('userId') userId: string): Promise<void> {
    return this.friends.remove(user.sub, userId);
  }
}
