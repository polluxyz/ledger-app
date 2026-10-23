import { ApiProperty } from '@nestjs/swagger';
import type {
  CategoryIcon,
  LedgerStatistics,
  StatisticsGroup,
  StatisticsGroupKind,
  StatisticsPerson,
  StatisticsTotals,
  StatisticsTrend,
  StatisticsTrendMonth,
} from '@ledger/shared';

/** 對外回應的 OpenAPI 結構與 shared 契約同步；所有金額皆為最小貨幣單位的整數。 */
export class StatisticsTotalsDto implements StatisticsTotals {
  @ApiProperty({ type: 'integer', minimum: 0 })
  income!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  expense!: number;

  @ApiProperty({ type: 'integer' })
  net!: number;
}

/** 只有真正的分類回傳此物件；固定分組不附任何往來或對象資料。 */
class StatisticsCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  icon!: CategoryIcon | null;
}

/** 百分比使用後端分配完成的萬分比，前端無須重算。 */
export class StatisticsGroupDto implements StatisticsGroup {
  @ApiProperty({ enum: ['CATEGORY', 'DIFFERENCE', 'BAD_DEBT', 'DEBT_FORGIVEN', 'UNCATEGORIZED'] })
  kind!: StatisticsGroupKind;

  @ApiProperty({ type: StatisticsCategoryDto, nullable: true })
  category!: StatisticsCategoryDto | null;

  @ApiProperty({ type: 'integer', minimum: 1 })
  amount!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 10000 })
  percentageBps!: number;
}

/** 人員金額固定使用帳本口徑，包含已離開與非成員的歸屬。 */
export class StatisticsPersonDto implements StatisticsPerson {
  @ApiProperty()
  personId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isMe!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0 })
  expense!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  income!: number;
}

/** 同一資料快照的摘要、分類與人員歸屬。 */
export class LedgerStatisticsResponseDto implements LedgerStatistics {
  @ApiProperty()
  ledgerId!: string;

  @ApiProperty({ example: '2026-10-01' })
  from!: string;

  @ApiProperty({ example: '2026-10-31' })
  to!: string;

  @ApiProperty({ type: StatisticsTotalsDto })
  ledger!: StatisticsTotalsDto;

  @ApiProperty({ type: StatisticsTotalsDto })
  mine!: StatisticsTotalsDto;

  @ApiProperty({ type: [StatisticsGroupDto] })
  expenseGroups!: StatisticsGroupDto[];

  @ApiProperty({ type: [StatisticsGroupDto] })
  incomeGroups!: StatisticsGroupDto[];

  @ApiProperty({ type: [StatisticsPersonDto], nullable: true })
  people!: StatisticsPersonDto[] | null;
}

/** 完整台灣曆月的收支點，無交易的月份也存在。 */
class StatisticsTrendMonthDto extends StatisticsTotalsDto implements StatisticsTrendMonth {
  @ApiProperty({ example: '2026-10' })
  month!: string;
}

/** 趨勢資料依月份由舊到新排列。 */
export class StatisticsTrendResponseDto implements StatisticsTrend {
  @ApiProperty()
  ledgerId!: string;

  @ApiProperty({ type: [StatisticsTrendMonthDto] })
  months!: StatisticsTrendMonthDto[];
}
