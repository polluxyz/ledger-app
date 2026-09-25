import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { FriendInviteTokenDto } from './friend-invite-token.dto';
import { LinkCounterpartyChoiceDto } from './link-counterparty-choice.dto';

/** `POST /friend-invite-links/accept` 的 body。`counterparty` 的規則同接受好友邀請。 */
export class AcceptFriendInviteLinkDto extends FriendInviteTokenDto {
  @ApiPropertyOptional({ type: LinkCounterpartyChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LinkCounterpartyChoiceDto)
  counterparty?: LinkCounterpartyChoiceDto;
}
