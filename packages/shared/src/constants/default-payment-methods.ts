/**
 * 每個新帳本都會複製一份的預設付款方式。與預設分類一樣被視為「使用者資料」
 * （可改名、可刪除），而非固定的系統值——保留未來 i18n 與各帳本自訂的彈性。
 *
 * 付款方式不帶 type，故用單純的名稱字串陣列即可（分類則需 name + type）。
 */
export const DEFAULT_PAYMENT_METHODS: readonly string[] = [
  '現金',
  '信用卡',
  '銀行轉帳',
  '行動支付',
] as const;
