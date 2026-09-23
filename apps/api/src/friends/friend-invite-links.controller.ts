import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  Friend,
  FriendInviteLinkCreated,
  FriendInviteLinkPreview,
  JwtPayload,
} from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FriendInviteTokenDto } from './dto/friend-invite-token.dto';
import { FriendInviteLinksService } from './friend-invite-links.service';
import { FRIEND_THROTTLE } from './friends-throttle';

/**
 * 好友邀請連結。token 一律放在 body，不放網址路徑（spec §3.4），所以預覽也用 POST。
 * 失效的連結不分原因，一律 `404 INVITE_LINK_INVALID`（spec §3.2）。
 */
@ApiTags('friend-invite-links')
@ApiBearerAuth('jwt')
@Controller('friend-invite-links')
export class FriendInviteLinksController {
  constructor(private readonly links: FriendInviteLinksService) {}

  @Post()
  @Throttle(FRIEND_THROTTLE)
  @ApiTooManyRequestsResponse({ description: 'More than 10 requests per minute from one IP.' })
  create(@CurrentUser() user: JwtPayload): Promise<FriendInviteLinkCreated> {
    return this.links.create(user.sub);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiNotFoundResponse({ description: 'INVITE_LINK_INVALID.' })
  preview(@Body() dto: FriendInviteTokenDto): Promise<FriendInviteLinkPreview> {
    return this.links.preview(dto.token);
  }

  @Post('accept')
  @Throttle(FRIEND_THROTTLE)
  @ApiBadRequestResponse({ description: 'CANNOT_FRIEND_SELF: this is your own link.' })
  @ApiNotFoundResponse({ description: 'INVITE_LINK_INVALID.' })
  @ApiConflictResponse({
    description:
      'ALREADY_FRIENDS. The link is not consumed and can still be given to someone else.',
  })
  @ApiTooManyRequestsResponse({ description: 'More than 10 requests per minute from one IP.' })
  accept(@CurrentUser() user: JwtPayload, @Body() dto: FriendInviteTokenDto): Promise<Friend> {
    return this.links.accept(user.sub, dto.token);
  }
}
