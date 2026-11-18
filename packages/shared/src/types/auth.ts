/** POST /auth/register 的請求 body。 */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

/** POST /auth/login 的請求 body。 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * 登入／認證成功的回應。刻意包成物件（而非光禿禿的 token 字串），日後要加入
 * 例如 refresh token 之類的欄位時，才不會破壞既有契約。
 */
export interface AuthTokenResponse {
  accessToken: string;
}

/**
 * 解出的 JWT payload。`sub` 是使用者 id（JWT 標準 claim）。
 * `sid` 是這一次登入在登入紀錄表的 id（R6 決策 375、383）：guard 每個請求用它查
 * 紀錄是否已撤銷或過期，登出也只撤銷這一筆。
 */
export interface JwtPayload {
  sub: string;
  email: string;
  sid: string;
}

/**
 * API 回傳的使用者形狀。絕不包含密碼雜湊或其他機敏欄位。
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** ISO 8601 時間戳。 */
  createdAt: string;
}

/** PATCH /users/me 的請求 body。 */
export interface UpdateUserRequest {
  name: string;
}
