import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { CreateCounterpartyRequest } from '@ledger/shared';

/** `POST /counterparties` 的 body：不記帳先新增一個人（3b-2 決策 55）。名字先去掉前後空白。 */
export class CreateCounterpartyDto implements CreateCounterpartyRequest {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name!: string;
}
