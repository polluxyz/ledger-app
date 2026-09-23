/**
 * 可注入的時鐘：service 透過它取得「現在」，而不是直接 `new Date()`。
 *
 * 為什麼需要：好友邀請連結 10 分鐘過期，測試若要真的等 10 分鐘就不可能寫。
 * 注入時鐘後，測試直接指定現在是幾點。
 *
 * 目前只有 friends 模組使用；既有模組沒有時間規則要測，不回頭改。
 */
export const CLOCK = Symbol('CLOCK');

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
