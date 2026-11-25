import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsUUID,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  GetLedgerStatisticsQuery,
  GetStatisticsTrendQuery,
  StatisticsFilters,
  StatisticsPerspective,
} from '@ledger/shared';

const PERSPECTIVES = { LEDGER: 'LEDGER', MINE: 'MINE' } as const;
const MAX_FILTER_IDS = 50;
export const INVALID_STATISTICS_FILTER = 'Invalid statistics filters.';
const filterError = { message: INVALID_STATISTICS_FILTER };

/** 保留重複參數，單一參數轉成陣列；讓驗證器拒絕其他輸入。 */
function FilterIds(): PropertyDecorator {
  return (target, key) => {
    ApiPropertyOptional({
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      maxItems: MAX_FILTER_IDS,
    })(target, key);
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? [value] : value))(
      target,
      key,
    );
    ValidateIf((_object, value: unknown) => value !== undefined)(target, key);
    IsArray(filterError)(target, key);
    ArrayMaxSize(MAX_FILTER_IDS, filterError)(target, key);
    IsUUID('all', { ...filterError, each: true })(target, key);
  };
}

/** 只接受網址上的 true 和 false，避免一般布林轉型把其他字串視為 true。 */
function FilterBoolean(): PropertyDecorator {
  return (target, key) => {
    ApiPropertyOptional({ type: Boolean })(target, key);
    Transform(({ value }: { value: unknown }) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value === undefined ? undefined : null;
    })(target, key);
    ValidateIf((_object, value: unknown) => value !== undefined)(target, key);
    IsBoolean(filterError)(target, key);
  };
}

/** 成員條件本身已指定歸屬口徑，不能和 MINE 同時使用。 */
@ValidatorConstraint()
class PersonFilterPerspective implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return (args.object as StatisticsFiltersDto).perspective !== 'MINE';
  }
}

/** 共用輸入邊界；保留原始無效值的拒絕結果，避免錯誤條件被視為沒有篩選。 */
export class StatisticsFiltersDto implements StatisticsFilters {
  @ApiPropertyOptional({ enum: PERSPECTIVES, default: 'LEDGER' })
  @IsEnum(PERSPECTIVES)
  perspective: StatisticsPerspective = 'LEDGER';

  @FilterIds()
  @Validate(PersonFilterPerspective, filterError)
  personIds?: string[];

  @FilterIds()
  categoryIds?: string[];

  @FilterIds()
  accountIds?: string[];

  @FilterBoolean()
  includeUncategorized?: boolean;

  @FilterBoolean()
  includeOtherAccounts?: boolean;
}

/** 統計查詢的輸入邊界；曆日存在與跨欄位期間限制由 service 使用共同期間函式驗證。 */
export class GetLedgerStatisticsDto
  extends StatisticsFiltersDto
  implements GetLedgerStatisticsQuery
{
  @ApiProperty({ example: '2026-10-01', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-10-31', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

/** 趨勢使用完整曆月；只轉換數量欄位，避免接受小數或非數字。 */
export class GetStatisticsTrendDto extends StatisticsFiltersDto implements GetStatisticsTrendQuery {
  @ApiProperty({ example: '2026-10', pattern: '^\\d{4}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}$/)
  endMonth!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 24, default: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months = 12;
}
