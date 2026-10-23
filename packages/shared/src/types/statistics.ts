import type { CategoryIcon } from '../constants/category-icons';
import type { Cents } from '../money';

/**
 * 2j 收支統計的 API 契約（spec `phase-2j-stats.md` §4.1、§4.2）。
 *
 * 所有金額、占比都由後端算好，前端只負責顯示（單一後端原則）。歸屬規則只有一套，
 * 寫在後端的統計 SQL 裡（決策 230），這裡只描述它的輸出形狀與不變量。
 */

/**
 * 分組用哪一種數字（決策 229）。
 *
 * - `LEDGER`：這本帳本所有算收支的交易加總，每筆算一次全額。
 * - `MINE`：其中算給我的部分。
 *
 * 私人帳本兩者相同。`people` 不受它影響（決策 265）。
 */
export type StatisticsPerspective = 'LEDGER' | 'MINE';

/** 收入、支出、淨額。單位：分。 */
export interface StatisticsTotals {
  /** 不為負（決策 262）。 */
  income: Cents;
  /** 不為負（決策 262）。退款是收入，不當成負支出抵銷。 */
  expense: Cents;
  /** income − expense，可以是負數。 */
  net: Cents;
}

/**
 * 分類區的分組（決策 234）。有分類的照分類分；沒有分類的分成 4 種固定分組。
 *
 * 差額、呆帳、債務免除只看自己的往來紀錄（決策 235）：共享帳本裡別人的這類交易，
 * 在我看來歸 `UNCATEGORIZED`，回應裡也不留對象或往來 id 這類線索。
 */
export type StatisticsGroupKind =
  | 'CATEGORY'
  /** 結清差額（3h 分支交易）。 */
  | 'DIFFERENCE'
  /** 呆帳：我免除別人欠我的。 */
  | 'BAD_DEBT'
  /** 債務免除：別人免除我欠的。 */
  | 'DEBT_FORGIVEN'
  | 'UNCATEGORIZED';

export interface StatisticsGroup {
  kind: StatisticsGroupKind;
  /** 只有 `CATEGORY` 有值。 */
  category: { id: string; name: string; icon: CategoryIcon | null } | null;
  /** 依 `perspective` 的金額，單位：分，大於 0。 */
  amount: Cents;
  /**
   * 在同一個方向（支出或收入）裡的占比，萬分比 0～10000（決策 260）。
   *
   * 同一個陣列加總固定等於 10000。捨入用最大餘數法分配，所以前端不要自己用 `amount` 重算：
   * 各自四捨五入的結果加起來可能是 9999 或 10001。金額為正但得到 0 的分組照樣列出。
   */
  percentageBps: number;
}

export interface StatisticsPerson {
  personId: string;
  /** 顯示用的名字，同借還頁的規則。 */
  name: string;
  isMe: boolean;
  /** 不為負（決策 262）。 */
  expense: Cents;
  /** 不為負（決策 262）。 */
  income: Cents;
}

/** `GET /ledgers/{ledgerId}/statistics` 的回應。totals、groups、people 讀同一份資料快照。 */
export interface LedgerStatistics {
  ledgerId: string;
  /** 照查詢參數回傳，`YYYY-MM-DD`。 */
  from: string;
  to: string;
  /** 兩種數字都回，首頁卡片不用打兩次（決策 229）。 */
  ledger: StatisticsTotals;
  mine: StatisticsTotals;
  /** 依 `amount` 由大到小，相同時依分組鍵；金額 0 的不列。 */
  expenseGroups: StatisticsGroup[];
  incomeGroups: StatisticsGroup[];
  /**
   * 共享帳本才有；私人帳本是 `null`。整本帳本的歸屬（決策 265）。
   * 依支出由大到小，相同時依 `personId`；收入與支出都是 0 的人不列。
   */
  people: StatisticsPerson[] | null;
}

/** `GET /ledgers/{ledgerId}/statistics` 的查詢參數。 */
export interface GetLedgerStatisticsQuery {
  /** 起日，包含，台灣時間，`YYYY-MM-DD`。 */
  from: string;
  /** 迄日，包含，台灣時間，`YYYY-MM-DD`。早於 `from`、或含起訖日超過 366 個台灣日 → 400。 */
  to: string;
  /** 預設 `LEDGER`。 */
  perspective?: StatisticsPerspective;
}

/** 趨勢的一個月。 */
export interface StatisticsTrendMonth extends StatisticsTotals {
  /** `YYYY-MM`，台灣時間的完整曆月（決策 264）。 */
  month: string;
}

/** `GET /ledgers/{ledgerId}/statistics/trend` 的回應。 */
export interface StatisticsTrend {
  ledgerId: string;
  /** 由舊到新，每個月都有，沒有交易的月份是 0。 */
  months: StatisticsTrendMonth[];
}

/** `GET /ledgers/{ledgerId}/statistics/trend` 的查詢參數。 */
export interface GetStatisticsTrendQuery {
  /** 最後一個月，`YYYY-MM`。 */
  endMonth: string;
  /** 往前幾個月（含 `endMonth`），1～24 的整數，預設 12。 */
  months?: number;
  /** 預設 `LEDGER`。 */
  perspective?: StatisticsPerspective;
}
