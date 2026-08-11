/**
 * @ledger/shared —— 跨端共用的型別、常數與工具。
 *
 * API 的 request／response 型別都放這裡，讓 apps/api、apps/web、apps/mobile
 * 對「契約」永遠有一致的認知（單一事實來源）。
 */

export * from './constants/error-codes';
export * from './constants/default-categories';
export * from './constants/default-payment-methods';
export * from './types/transaction';
export * from './types/auth';
export * from './types/ledger';
export * from './types/category';
export * from './types/payment-method';
export * from './types/pagination';
