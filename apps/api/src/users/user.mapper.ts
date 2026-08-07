import { AuthUser } from '@ledger/shared';

/** Projects a DB user row onto the public AuthUser shape (no passwordHash). */
export function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}
