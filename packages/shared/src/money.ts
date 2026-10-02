/**
 * 金額的單位與換算（3c-0，spec `docs/specs/phase-3c0-money-cents.md`）。
 *
 * 系統裡所有金額都是「分」（0.01 元）的整數：資料庫、API、後端運算一律如此，後端
 * 從不換算單位。只有畫面需要在「分」與「人看的元」之間轉換，而且**只能透過這裡的
 * 函式**（決策 M5）——元件裡出現 `* 100`、`/ 100` 就是漏網之魚。
 *
 * 輸入的解析刻意用字串運算：`parseFloat('0.29') * 100` 是 `28.999999999999996`，
 * 浮點數在金額上一定會在某個邊界出錯（`CLAUDE.md` §6）。
 */

/** 金額，單位：分（0.01 元）。只是別名，用來在型別上標出單位。 */
export type Cents = number;

/**
 * 單筆金額的上限：2,000 萬元（決策 M4）。資料庫是 int4（上限約 2,147 萬元），留一點餘裕。
 * 套用在交易、往來紀錄的 `amount`。
 */
export const MAX_AMOUNT_CENTS: Cents = 2_000_000_000;

/** 帳戶期初餘額的範圍：±2,000 萬元（決策 M4）。 */
export const MAX_INITIAL_BALANCE_CENTS: Cents = 2_000_000_000;

/**
 * 只加千分位、不帶貨幣符號與正負號的金額。整數元不顯示小數（決策 M6）。
 *
 * 300000 → "3,000"；33333 → "333.33"；50 → "0.50"；-120000 → "1,200"（取絕對值）。
 */
export function formatAmount(cents: Cents): string {
  const absoluteCents = Math.abs(cents);
  const wholeAmount = Math.floor(absoluteCents / 100);
  const remainingCents = absoluteCents % 100;
  const formattedWhole = wholeAmount.toLocaleString('zh-TW');

  return remainingCents === 0
    ? formattedWhole
    : `${formattedWhole}.${String(remainingCents).padStart(2, '0')}`;
}

/**
 * 帶貨幣符號的金額，負號放在 `$` 前面（沿用 Web 原本的寫法）。
 *
 * 33333 → "$333.33"；300000 → "$3,000"；-120000 → "-$1,200"；0 → "$0"。
 */
export function formatMoney(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${formatAmount(Math.abs(cents))}`;
}

/**
 * 給輸入框的預設值：不帶貨幣符號、不加千分位。
 *
 * 33333 → "333.33"；300000 → "3000"；50 → "0.5"；-120000 → "-1200"。
 */
export function centsToInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const absoluteCents = Math.abs(cents);
  const wholeAmount = Math.floor(absoluteCents / 100);
  const remainingCents = absoluteCents % 100;

  if (remainingCents === 0) {
    return `${sign}${wholeAmount}`;
  }

  const fraction = String(remainingCents).padStart(2, '0').replace(/0$/, '');
  return `${sign}${wholeAmount}.${fraction}`;
}

/**
 * 使用者輸入 → 分。用字串運算，不經過浮點數。
 *
 * 先去掉前後空白與千分位逗號，再要求 `^-?\d+(\.\d{1,2})?$`：
 * "333.33" → 33333；"3000" → 300000；"0.5" → 50；"1,200" → 120000；"0.3" → 30。
 * 超過兩位小數（"1.234"）、空字串、非數字、只有小數點（".5"、"5."）→ null。
 * 負數只在 `allowNegative: true` 時接受（帳戶期初餘額），否則 null。
 * 結果超出 `Number.MAX_SAFE_INTEGER` → null。
 */
export function parseMoneyInput(text: string, options?: { allowNegative?: boolean }): Cents | null {
  const normalized = text.trim().replaceAll(',', '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);

  if (!match) {
    return null;
  }

  const [, sign, wholeText, fractionText = ''] = match;
  if (sign === '-' && options?.allowNegative !== true) {
    return null;
  }

  const wholeAmount = Number(wholeText);
  const fraction = Number(fractionText.padEnd(2, '0'));
  if (!Number.isSafeInteger(wholeAmount)) {
    return null;
  }

  const absoluteCents = wholeAmount * 100 + fraction;
  if (!Number.isSafeInteger(absoluteCents)) {
    return null;
  }

  if (absoluteCents === 0) {
    return 0;
  }

  return sign === '-' ? -absoluteCents : absoluteCents;
}
