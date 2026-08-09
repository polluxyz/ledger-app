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

/** 解出的 JWT payload。`sub` 是使用者 id（JWT 標準 claim）。 */
export interface JwtPayload {
  sub: string;
  email: string;
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
