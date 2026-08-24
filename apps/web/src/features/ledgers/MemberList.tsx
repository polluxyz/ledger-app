import { LEDGER_ROLES, type LedgerMemberInfo, type LedgerRole } from '@ledger/shared';
import { ROLE_LABEL } from './role-labels';
import styles from './MemberList.module.css';

interface MemberListProps {
  members: LedgerMemberInfo[];
  /** 目前登入者的 id；用來認出「我」那一列。載入中為 undefined。 */
  currentUserId: string | undefined;
  /** 我是不是 owner。決定畫不畫管理操作——**這是體驗，不是授權**。 */
  isOwner: boolean;
  /** 帳本已封存時整個唯讀（S6-D4）。 */
  isArchived: boolean;
  /** 正在被改角色或移除的成員；用來停用該列，避免重複送出。 */
  pendingUserId?: string;
  /** 送出後才發生的錯誤，貼在對應的那一列底下。 */
  rowError?: { userId: string; message: string };
  onChangeRole: (member: LedgerMemberInfo, role: LedgerRole) => void;
  onRemove: (member: LedgerMemberInfo) => void;
  onLeave: (member: LedgerMemberInfo) => void;
}

/**
 * 帳本的成員清單，附帶依角色決定的操作。
 *
 * ## 誰看得到什麼（S6 提案）
 *
 * - **改角色 / 移除**：owner 才畫，而且不對自己畫——自己那列改成「退出」。
 * - **退出帳本**：**每個成員都畫，包含 owner**。擋掉等於把人困在別人的帳本裡。
 *   （最後一位 owner 按下去會拿到 409，那是後端該講的話，不是前端先攔。）
 *
 * 這些一律是**隱藏，不是停用**，而且只是體驗。真正的防線是後端的 `@RequireLedgerRole`；
 * 這裡從不用角色決定「資料能不能拿」，只決定「按鈕畫不畫」。
 *
 * ## 錯誤為什麼貼在那一列
 *
 * 整頁共用一個錯誤框的話，使用者看得到「帳本至少要有一位擁有者」，卻不知道是哪一列
 * 造成的——成員一多就更難認。`rowError` 帶著 `userId`，只顯示在對應的那一列底下。
 */
export function MemberList({
  members,
  currentUserId,
  isOwner,
  isArchived,
  pendingUserId,
  rowError,
  onChangeRole,
  onRemove,
  onLeave,
}: MemberListProps) {
  return (
    <ul className={styles.list}>
      {members.map((member) => {
        const isMe = member.userId === currentUserId;
        const isPending = member.userId === pendingUserId;
        // 封存帳本的所有寫入都會被後端擋成 409 LEDGER_ARCHIVED（連退出也是，
        // 見 S6-D4）。與其畫一堆註定失敗的按鈕，不如整個唯讀。
        const canManage = isOwner && !isMe && !isArchived;

        return (
          <li className={styles.item} key={member.userId}>
            <div className={styles.row}>
              <div className={styles.who}>
                <span className={styles.name}>
                  {member.name}
                  {isMe && <span className={styles.me}>（我）</span>}
                </span>
                <span className={styles.email}>{member.email}</span>
              </div>

              <div className={styles.right}>
                {canManage ? (
                  <select
                    className={styles.role}
                    aria-label={`${member.name}的角色`}
                    value={member.role}
                    disabled={isPending}
                    onChange={(event) => onChangeRole(member, event.target.value as LedgerRole)}
                  >
                    {LEDGER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={styles.roleTag}>{ROLE_LABEL[member.role]}</span>
                )}

                {canManage && (
                  <button
                    type="button"
                    className={`${styles.action} ${styles.danger}`}
                    disabled={isPending}
                    onClick={() => onRemove(member)}
                    aria-label={`移除${member.name}`}
                  >
                    移除
                  </button>
                )}

                {isMe && !isArchived && (
                  <button
                    type="button"
                    className={`${styles.action} ${styles.danger}`}
                    disabled={isPending}
                    onClick={() => onLeave(member)}
                  >
                    退出帳本
                  </button>
                )}
              </div>
            </div>

            {rowError?.userId === member.userId && (
              <p className={styles.error} role="alert">
                {rowError.message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
