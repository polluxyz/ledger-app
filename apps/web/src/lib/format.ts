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
