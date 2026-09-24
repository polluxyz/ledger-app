import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { UpdateDebtEntryRequest } from '@ledger/shared';

/** `PATCH /debt-entries/{id}` 的 body。只有送出的欄位會變（決策 41）。 */
export class UpdateDebtEntryDto implements UpdateDebtEntryRequest {
  @ApiPropertyOptional({ description: 'Positive integer; the sign comes from the entry kind.' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  /** 送 `null` 清除備註；省略代表不動。 */
  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
