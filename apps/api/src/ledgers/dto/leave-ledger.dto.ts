import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { LeaveMove, LeaveRequest } from '@ledger/shared';

/** 一組搬到同一本帳本的項目；跨組重複與項目歸屬由計畫函式檢查。 */
export class LeaveMoveDto implements LeaveMove {
  @ApiProperty({ type: String, format: 'uuid', description: 'Writable destination ledger.' })
  @IsUUID()
  targetLedgerId!: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 5000, description: 'Preview item UUIDs.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  itemIds!: string[];
}

/** 兩種帳本帶的欄位不同；種類相關的規則在 service 檢查，null 表示共享帳本不合併。 */
export class LeaveLedgerDto implements LeaveRequest {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  targetLedgerId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 5000,
    description: 'UUIDs of unchecked preview items; shared ledgers only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  excludedItemIds?: string[];

  @ApiPropertyOptional({
    type: [LeaveMoveDto],
    maxItems: 5000,
    description: 'Personal ledger deletion only; empty means move nothing.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => LeaveMoveDto)
  moves?: LeaveMoveDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deleteLedger?: boolean;

  @ApiPropertyOptional({
    description: 'Exact source ledger name, required when executing deletion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  confirm?: string;
}
