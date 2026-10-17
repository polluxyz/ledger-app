import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** 刪除必須確認名稱；只有明確的 true 才能同意撤銷借還。 */
export class RemoveLedgerQueryDto {
  @ApiPropertyOptional({ description: 'Must exactly equal the ledger name.' })
  @IsOptional()
  @IsString()
  confirm?: string;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  withdrawDebts?: boolean;
}
