/** API 回傳的付款方式形狀。與分類類似，但不帶 type（收入 / 支出共用同一組）。 */
export interface PaymentMethod {
  id: string;
  name: string;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** POST /ledgers/{ledgerId}/payment-methods 的請求 body。 */
export interface CreatePaymentMethodRequest {
  name: string;
}

/** PATCH /ledgers/{ledgerId}/payment-methods/{id} 的請求 body。 */
export interface UpdatePaymentMethodRequest {
  name: string;
}
