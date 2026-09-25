import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { LinkCounterpartyChoiceDto } from './link-counterparty-choice.dto';

/**
 * `POST /friend-requests/{id}/accept` 的 body。連動邀請必填 `counterparty`，一般好友邀請
 * 不可帶；要讀出邀請才知道是哪一種，所以由 service 檢查。
 */
export class AcceptFriendRequestDto {
  @ApiPropertyOptional({ type: LinkCounterpartyChoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LinkCounterpartyChoiceDto)
  counterparty?: LinkCounterpartyChoiceDto;
}
