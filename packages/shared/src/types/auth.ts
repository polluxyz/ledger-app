/** Body of POST /auth/register. */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

/** Body of POST /auth/login. */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Successful login/auth response. Wrapped in an object (rather than a bare
 * token string) so future fields such as a refresh token can be added without
 * breaking the contract.
 */
export interface AuthTokenResponse {
  accessToken: string;
}

/** Decoded JWT payload. `sub` is the user id (JWT standard claim). */
export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * A user as returned by the API. Never includes the password hash or any
 * other sensitive field.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}
