/**
 * A user's role within a ledger. Mirrors the Prisma `LedgerRole` enum.
 * Declared as a const tuple so the values can be reused for runtime
 * validation (e.g. class-validator @IsIn).
 */
export const LEDGER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

/** Core ledger fields shared by every ledger response shape. */
export interface Ledger {
  id: string;
  name: string;
  /** ISO 4217 currency code (phase 1: always TWD). */
  currency: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A ledger plus the requesting user's role in it (used in list endpoints). */
export interface LedgerSummary extends Ledger {
  role: LedgerRole;
}

/** One member of a ledger, with enough user detail for display. */
export interface LedgerMemberInfo {
  userId: string;
  email: string;
  name: string;
  role: LedgerRole;
}

/** A ledger with its full member list (ledger detail endpoint). */
export interface LedgerDetail extends Ledger {
  members: LedgerMemberInfo[];
}

/** Body of POST /ledgers. */
export interface CreateLedgerRequest {
  name: string;
}

/** Body of PATCH /ledgers/{ledgerId}. */
export interface UpdateLedgerRequest {
  name: string;
}

/** Body of POST /ledgers/{ledgerId}/members: add a registered user by email. */
export interface AddMemberRequest {
  email: string;
  role: LedgerRole;
}

/** Body of PATCH /ledgers/{ledgerId}/members/{userId}: change a member's role. */
export interface UpdateMemberRequest {
  role: LedgerRole;
}
