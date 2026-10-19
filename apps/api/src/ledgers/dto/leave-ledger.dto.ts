import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { LeaveRequest } from '@ledger/shared';

/** 預覽與退出共用契約；null 代表全部不合併，不可省略必要欄位。 */
export class LeaveLedgerDto implements LeaveRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  targetLedgerId!: string | null;

  @ApiProperty({ type: [String], maxItems: 5000, description: 'UUIDs of unchecked preview items.' })
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  excludedItemIds!: string[];

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
