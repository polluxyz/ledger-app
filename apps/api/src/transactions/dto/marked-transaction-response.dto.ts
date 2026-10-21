import { ApiProperty } from '@nestjs/swagger';
import {
  DEBT_ENTRY_KINDS,
  DEBT_ENTRY_SYNC_STATUSES,
  TRANSACTION_TYPES,
  type MarkedTransaction,
} from '@ledger/shared';

/** 共用引用與巢狀欄位的 Swagger 形狀；保持標註回應與交易契約的完整欄位一致。 */
class ReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
}

/** 分類引用另外帶圖示。 */
class CategoryDto extends ReferenceDto {
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
}

/** 共享帳本裡的人，包含成員與虛擬成員。 */
class PersonDto extends ReferenceDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  userId!: string | null;
  @ApiProperty({ enum: ['MEMBER', 'LEFT', 'GUEST'] })
  status!: string;
}

/** 僅往來擁有者看得到的交易背後資料。 */
class DebtDto {
  @ApiProperty({ format: 'uuid' })
  entryId!: string;
  @ApiProperty({ enum: DEBT_ENTRY_KINDS })
  kind!: string;
  @ApiProperty({ format: 'uuid' })
  counterpartyId!: string;
  @ApiProperty()
  counterpartyName!: string;
  @ApiProperty()
  paired!: boolean;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

/** 個人分帳中的付款對象。 */
class MarkedSplitPayerDto {
  @ApiProperty({ format: 'uuid' })
  counterpartyId!: string;
  @ApiProperty()
  name!: string;
}

/** 個人分帳中與本人有關的應收應付。 */
class CounterpartDto extends MarkedSplitPayerDto {
  @ApiProperty({ description: '金額，單位：分。' })
  amount!: number;
  @ApiProperty({ enum: ['THEY_OWE_ME', 'I_OWE_THEM'] })
  direction!: string;
  @ApiProperty({ enum: DEBT_ENTRY_SYNC_STATUSES })
  sync!: string;
}

/** 個人分帳的摘要，只回給擁有者。 */
class SplitDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['EXPENSE', 'INCOME'] })
  type!: string;
  @ApiProperty()
  total!: number;
  @ApiProperty()
  myShare!: number;
  @ApiProperty({ type: MarkedSplitPayerDto, nullable: true })
  payer!: MarkedSplitPayerDto | null;
  @ApiProperty({ type: [CounterpartDto] })
  counterparts!: CounterpartDto[];
}

/** 共享分帳名單裡一位的份額。 */
class ShareDto {
  @ApiProperty({ type: PersonDto })
  person!: PersonDto;
  @ApiProperty()
  share!: number;
  @ApiProperty({ type: Number, nullable: true })
  ratio!: number | null;
}

/** 共享帳本的分帳名單，所有成員皆可見。 */
class MarkedLedgerSplitDto {
  @ApiProperty({ enum: ['EQUAL', 'AMOUNT', 'RATIO'] })
  method!: string;
  @ApiProperty({ enum: ['CENT', 'YUAN'] })
  precision!: string;
  @ApiProperty({ type: [ShareDto] })
  shares!: ShareDto[];
}

/** 共享結清的付款人與收款人。 */
class SettlementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ type: PersonDto })
  from!: PersonDto;
  @ApiProperty({ type: PersonDto })
  to!: PersonDto;
}

/** 還款之下的結清差額。 */
class DifferenceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['EXPENSE', 'INCOME'] })
  type!: string;
  @ApiProperty()
  amount!: number;
}

/** 合併者本人才看得到的來源與份額。 */
class MergeDto {
  @ApiProperty()
  sourceLedgerName!: string;
  @ApiProperty({ type: Number, nullable: true })
  share!: number | null;
}

/** 每筆標註沿用交易的遮蔽、分帳與合併規則，另帶目前所在帳本。 */
export class MarkedTransactionDto implements MarkedTransaction {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: TRANSACTION_TYPES })
  type!: MarkedTransaction['type'];
  @ApiProperty({ minimum: 1, description: '金額，單位：分；合併列含代墊／代收。' })
  amount!: number;
  @ApiProperty({ format: 'date-time' })
  date!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  title!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: CategoryDto, nullable: true })
  category!: MarkedTransaction['category'];
  @ApiProperty({ type: ReferenceDto, nullable: true, description: '他人的帳戶遮為 null。' })
  account!: MarkedTransaction['account'];
  @ApiProperty({ type: ReferenceDto, nullable: true, description: '他人的轉入帳戶遮為 null。' })
  toAccount!: MarkedTransaction['toAccount'];
  @ApiProperty({ type: ReferenceDto })
  creator!: MarkedTransaction['creator'];
  @ApiProperty({ type: DebtDto, nullable: true, description: '僅往來擁有者可見。' })
  debt!: MarkedTransaction['debt'];
  @ApiProperty({ type: SplitDto, nullable: true, description: '僅分帳擁有者可見。' })
  split!: MarkedTransaction['split'];
  @ApiProperty({ type: PersonDto, nullable: true })
  payer!: MarkedTransaction['payer'];
  @ApiProperty({ type: MarkedLedgerSplitDto, nullable: true })
  ledgerSplit!: MarkedTransaction['ledgerSplit'];
  @ApiProperty({ type: SettlementDto, nullable: true })
  settlement!: MarkedTransaction['settlement'];
  @ApiProperty({ description: '本人是否需要補上帳戶。' })
  accountPending!: boolean;
  @ApiProperty({ type: String, nullable: true })
  differenceOfId!: string | null;
  @ApiProperty({ type: DifferenceDto, nullable: true })
  difference!: MarkedTransaction['difference'];
  @ApiProperty({ type: MergeDto, nullable: true })
  merge!: MarkedTransaction['merge'];
  @ApiProperty({ description: '呼叫者自己的標註。' })
  marked!: boolean;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: ReferenceDto, description: '交易目前所在的帳本。' })
  ledger!: MarkedTransaction['ledger'];
}

/** 標註列表的分頁信封；total 是所有頁的可見標註數。 */
export class PaginatedMarkedTransactionDto {
  @ApiProperty({ type: [MarkedTransactionDto] })
  items!: MarkedTransactionDto[];
  @ApiProperty({ minimum: 1, default: 1 })
  page!: number;
  @ApiProperty({ minimum: 1, maximum: 100, default: 10 })
  limit!: number;
  @ApiProperty({ minimum: 0 })
  total!: number;
}
