import { ApiPropertyOptional } from '@nestjs/swagger';
import type { RecordDefaultsQuery } from '@ledger/shared';
import { IsOptional, IsUUID } from 'class-validator';

/** 帳本已由頁面選定時，限定最近使用的帳戶搜尋範圍。 */
export class RecordDefaultsQueryDto implements RecordDefaultsQuery {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '已選定的帳本；須是目前使用者的成員。',
  })
  @IsOptional()
  @IsUUID()
  ledgerId?: string;
}
