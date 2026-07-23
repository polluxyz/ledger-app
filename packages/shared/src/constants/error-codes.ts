/**
 * Stable, machine-readable error codes returned by the API.
 *
 * Clients should branch on these rather than on the human-readable `message`,
 * which is advisory only and may change. This is also the extension point for
 * future i18n: the frontend maps a code to a localized string.
 *
 * Feature-specific codes (ledger membership, transactions, ...) are added
 * alongside these as those modules are built.
 */
export const ErrorCode = {
  /** Request body / query failed DTO validation. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** No authentication, or the credentials/token are invalid. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Authenticated, but not allowed to perform this action. */
  FORBIDDEN: 'FORBIDDEN',
  /** Resource does not exist, or the caller may not know that it does. */
  NOT_FOUND: 'NOT_FOUND',
  /** Request conflicts with the current state (duplicate, invariant broken). */
  CONFLICT: 'CONFLICT',
  /** Too many requests (rate limited). */
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** Unexpected server-side failure; details are never exposed to clients. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Shape of every error response the API returns. */
export interface ApiErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  /** Field-level messages; present for validation failures only. */
  details?: string[];
}
