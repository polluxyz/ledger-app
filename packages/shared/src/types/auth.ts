/** Body of POST /auth/register. */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
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
