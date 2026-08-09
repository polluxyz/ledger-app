import { AuthUser } from '@ledger/shared';

/**
 * 把資料庫的 user 資料列投影成對外的 AuthUser 形狀（不含 passwordHash）。
 * 集中在這一處，避免任何端點不小心把密碼雜湊回傳給客戶端。
 */
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
