import type { TransactionType } from '@ledger/shared';

/**
 * 顯示用的格式化工具。純粹是呈現層——不做任何金額運算（加總、換算一律屬
 * 後端職責）。
 */

/**
 * 把金額整數格式化成人看的字串。
 *
 * 後端存的是「帳本幣別的最小單位」，而 TWD 的最小單位就是元，因此**不做任何
 * 除法換算**，只加上千分位。未來支援有輔幣的幣別（如 USD 的分）時，需依幣別
 * 的小數位數處理，屆時對照表會放在 packages/shared。
 */
export function formatAmount(amount: number): string {
  return amount.toLocaleString('zh-TW');
}

/**
 * 帶貨幣符號的金額：`$3,240`、`-$6,820`。
 *
 * 負號放在 `$` 前面。直接寫 `` `$${formatAmount(n)}` `` 會得到 `$-6,820`，
 * 而交易列表的支出寫成 `-$120`——同一個 app 兩種寫法，使用者得多想一下
 * 哪個才是「欠錢」。負數餘額（信用卡欠款）是正常狀態，寫法要跟支出一致。
 */
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${formatAmount(Math.abs(amount))}`;
}

/**
 * 交易金額的前綴。轉帳刻意**不用正負號**：錢只是換了帳戶，既不是支出也不是
 * 收入，用「−」會讓人以為花掉了。三種型別各自給值，而不是「非支出即收入」的
 * 二分法——後者在 TRANSFER 出現後就是錯的。
 */
const TRANSACTION_SIGN: Record<TransactionType, string> = {
  EXPENSE: '-',
  INCOME: '+',
  TRANSFER: '',
};

/**
 * 交易列上的金額：`-$120`、`+$5,000`、`$500`（轉帳）。
 *
 * 交易頁的表格與首頁的「最近交易」共用這一個函式（2i）。兩處各寫一份的話，
 * 改了其中一邊，同一筆交易在兩頁就會長得不一樣——e2e 也是靠這個字串找列的。
 */
export function formatTransactionAmount(type: TransactionType, amount: number): string {
  return `${TRANSACTION_SIGN[type]}$${formatAmount(amount)}`;
}

/** ISO 8601 時間字串轉成 `2026/08/12` 這種好讀的日期。 */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 星期縮寫，索引對 `Date.getDay()`（0＝星期日）。 */
const WEEKDAY_SHORT_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * 交易列表「日期分組」的標題文字，如 `8月16日 星期日`（phase-2h D16）。
 *
 * 與 `formatDate` 同樣用本地時區解讀 ISO 字串，兩者對同一筆交易算出的日期
 * 才會一致（分組的判斷就是拿 `formatDate` 的結果比較的）。不加零填充——
 * 標題是給人掃視的，`9月1日` 比 `09月01日` 好讀。
 */
export function formatGroupDate(isoDate: string): string {
  const date = new Date(isoDate);
  return `${date.getMonth() + 1}月${date.getDate()}日 星期${WEEKDAY_SHORT_NAMES[date.getDay()]}`;
}

/** 產生 `<input type="date">` 需要的 `YYYY-MM-DD` 字串（預設今天）。 */
export function toDateInputValue(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
