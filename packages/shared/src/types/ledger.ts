/** A user's role within a ledger. Mirrors the Prisma `LedgerRole` enum. */
export type LedgerRole = 'OWNER' | 'EDITOR' | 'VIEWER';

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
