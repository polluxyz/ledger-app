/**
 * 好友相關端點的流量限制：每 IP 每分鐘 10 次（spec 決策 16）。
 *
 * 送出邀請會告訴呼叫者「這個 email 有沒有註冊」（決策 3），所以限制的是「查一個 email
 * 的速度」（SEC-11）。產生與接受連結一併限制，防止大量產生連結或猜 token。
 */
export const FRIEND_THROTTLE = { default: { ttl: 60_000, limit: 10 } };
