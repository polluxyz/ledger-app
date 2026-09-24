import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { UpdateCounterpartyRequest } from '@ledger/shared';

/** `PATCH /counterparties/{id}` 的 body：改名。名字先去掉前後空白（決策 33）。 */
export class UpdateCounterpartyDto implements UpdateCounterpartyRequest {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name!: string;
}
