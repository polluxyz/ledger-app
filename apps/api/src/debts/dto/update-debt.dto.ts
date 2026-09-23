import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UpdateDebtRequest } from '@ledger/shared';

/**
 * `PATCH /debts/{id}` 的 body。只有送出的欄位會被更新。
 *
 * 方向（借出／借入）不能改：改了等於本金交易的資金方向整個反轉，那是刪掉重建，不是修改。
 * 「新本金不得小於已還總額」要查資料庫，由 service 把關。
 */
export class UpdateDebtDto implements UpdateDebtRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  counterpartyName?: string;

  @ApiPropertyOptional({ description: 'Positive integer; cannot drop below the total repaid.' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  principal?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  // `@IsOptional` 同時放行 undefined 與 null：送 null 表示清除備註。
  @ApiPropertyOptional({ maxLength: 500, nullable: true, description: 'Send null to clear.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
