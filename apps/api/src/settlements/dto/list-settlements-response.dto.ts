import { ApiProperty } from '@nestjs/swagger';
import {
  LEDGER_PERSON_STATUSES,
  TRANSACTION_TYPES,
  type LedgerPerson,
  type LedgerPersonStatus,
  type LedgerSplitView,
  type Transaction,
  type TransactionCategoryRef,
  type TransactionDebtRef,
  type TransactionRef,
  type TransactionSettlementRef,
  type TransactionSplitRef,
  type TransactionType,
} from '@ledger/shared';

/**
 * `GET /ledgers/{ledgerId}/settlements` 的 OpenAPI 回應形狀（3g §4.2）。
 *
 * 這裡是 `Paginated<Transaction>` 的 Swagger 版本：契約本體在 `packages/shared` 的
 * `Transaction`，本檔只負責讓自動產生的文件正確，改 shared 形狀時要同步這裡。
 * 結清是 `TRANSFER` 交易，`payer`／`ledgerSplit`／`debt`／`split` 對結清恆為 null，
 * 文件上仍保留欄位（序列化器會輸出），並標明恆為 null。
 */

/** shared `TransactionRef` 的 Swagger 版：帳戶與建立者的精簡引用。 */
class RefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '現金' })
  name!: string;
}

/** shared `TransactionCategoryRef` 的 Swagger 版。 */
class CategoryRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '餐飲' })
  name!: string;

  @ApiProperty({ example: 'food', nullable: true })
  icon!: string | null;
}

/** shared `LedgerPerson` 的 Swagger 版：結清的付錢與收錢兩位都是這個形狀。 */
class LedgerPersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '小明' })
  name!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: '虛擬成員為 null。' })
  userId!: string | null;

  @ApiProperty({ enum: LEDGER_PERSON_STATUSES })
  status!: LedgerPersonStatus;
}

/** shared `TransactionSettlementRef` 的 Swagger 版：這筆結清的兩位。 */
class SettlementRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: '付錢的那位。' })
  from!: LedgerPersonDto;

  @ApiProperty({ description: '收錢的那位。' })
  to!: LedgerPersonDto;
}

/** 一筆結清交易（就是帶 `settlement` 的 `Transaction`）。 */
export class SettlementTransactionDto implements Transaction {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES, description: '結清恆為 TRANSFER。' })
  type!: TransactionType;

  @ApiProperty({ minimum: 1, description: '金額，單位：分。' })
  amount!: number;

  @ApiProperty({ format: 'date-time', description: '這筆錢發生的時間。' })
  date!: string;

  @ApiProperty({ nullable: true, maxLength: 100 })
  title!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ type: CategoryRefDto, nullable: true, description: 'TRANSFER 恆為 null。' })
  category!: TransactionCategoryRef | null;

  @ApiProperty({
    type: RefDto,
    nullable: true,
    description: '錢從哪個帳戶出去；不屬於檢視者的帳戶一律遮成 null。',
  })
  account!: TransactionRef | null;

  @ApiProperty({
    type: RefDto,
    nullable: true,
    description: '錢轉入哪個帳戶；同樣套用檢視者的遮蔽規則。',
  })
  toAccount!: TransactionRef | null;

  @ApiProperty({ type: RefDto, description: '由誰記下。' })
  creator!: TransactionRef;

  @ApiProperty({ nullable: true, type: Object, description: '結清恆為 null。' })
  debt!: TransactionDebtRef | null;

  @ApiProperty({ nullable: true, type: Object, description: '結清恆為 null。' })
  split!: TransactionSplitRef | null;

  @ApiProperty({ nullable: true, type: Object, description: '結清恆為 null。' })
  payer!: LedgerPerson | null;

  @ApiProperty({ nullable: true, type: Object, description: '結清恆為 null。' })
  ledgerSplit!: LedgerSplitView | null;

  @ApiProperty({ type: SettlementRefDto, description: '這筆結清的付錢與收錢兩位。' })
  settlement!: TransactionSettlementRef;

  @ApiProperty({
    type: Boolean,
    description: '這一邊在檢視者本人的臨時帳戶（付錢或收錢的那位，3h 決策 168）。',
  })
  accountPending!: boolean;

  @ApiProperty({ type: String, nullable: true, description: '結清不是分支，恆為 null。' })
  differenceOfId!: string | null;

  @ApiProperty({ type: Object, nullable: true, description: '結清沒有分支，恆為 null。' })
  difference!: null;

  @ApiProperty({ type: Object, nullable: true, description: '結清不是合併來的，恆為 null（3k）。' })
  merge!: null;

  @ApiProperty({ description: '我有沒有標註這筆（3l 決策 222）；只看呼叫者自己的標註。' })
  marked!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** 分頁信封，與 shared `Paginated<Transaction>` 同步。 */
export class PaginatedSettlementTransactionDto {
  @ApiProperty({ type: [SettlementTransactionDto] })
  items!: SettlementTransactionDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ description: '符合範圍的總筆數（跨所有頁）。' })
  total!: number;
}
