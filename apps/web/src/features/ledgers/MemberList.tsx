import type { LedgerMemberInfo, LedgerPerson, LedgerRole } from '@ledger/shared';
import { ROLE_LABEL, ROLE_OPTIONS } from './role-labels';
import styles from './MemberList.module.css';

interface MemberListProps {
  members: LedgerMemberInfo[];
  virtualMembers: LedgerPerson[];
  /** 目前登入者的 id；用來認出「我」那一列。載入中為 undefined。 */
  currentUserId: string | undefined;
  /** 我是不是 owner。決定畫不畫管理操作——這是體驗，不是授權。 */
  isOwner: boolean;
  /** 帳本已封存時整個唯讀。 */
  isArchived: boolean;
  /** 是否能管理虛擬成員；與角色及封存狀態由頁面決定。 */
  canManageVirtualMembers: boolean;
  /** 正在被改角色或移除的成員；用來停用該列，避免重複送出。 */
  pendingUserId?: string;
  /** 送出後才發生的錯誤，貼在對應的那一列底下。 */
  rowError?: { userId: string; message: string };
  /** person id 與 user id 對應到目前使用者看得到的指向名稱。 */
  pointerNames: Readonly<Record<string, string>>;
  onChangeRole: (member: LedgerMemberInfo, role: LedgerRole) => void;
  onRemove: (member: LedgerMemberInfo) => void;
  onLeave: (member: LedgerMemberInfo) => void;
  onRenameVirtualMember: (person: LedgerPerson) => void;
  onDeleteVirtualMember: (person: LedgerPerson) => void;
}

const REMOVE_MEMBER_VALUE = '__remove-member__';

/**
 * 帳本裡有帳號的人與虛擬成員共用一張清單，讓角色、指向與管理入口都留在同一處。
 * 角色與虛擬成員的操作依頁面傳入的權限顯示；後端仍負責實際授權。
 */
export function MemberList({
  members,
  virtualMembers,
  currentUserId,
  isOwner,
  isArchived,
  canManageVirtualMembers,
  pendingUserId,
  rowError,
  pointerNames,
  onChangeRole,
  onRemove,
  onLeave,
  onRenameVirtualMember,
  onDeleteVirtualMember,
}: MemberListProps) {
  const currentMember = members.find((member) => member.userId === currentUserId);

  return (
    <>
      <ul className={styles.list} aria-label="帳本成員">
        {members.map((member) => {
          const isMe = member.userId === currentUserId;
          const isPending = member.userId === pendingUserId;
          const canManage = isOwner && !isMe && !isArchived;

          return (
            <li className={styles.item} key={member.userId}>
              <div className={styles.row}>
                <div className={styles.who}>
                  <span className={styles.name}>
                    {member.name}
                    {isMe && <span className={styles.me}>（我）</span>}
                  </span>
                  {pointerNames[member.userId] && (
                    <span className={styles.pointer}>→ {pointerNames[member.userId]}</span>
                  )}
                </div>

                <div className={styles.right}>
                  {canManage ? (
                    <select
                      className={styles.role}
                      aria-label={`${member.name}的角色`}
                      value={member.role}
                      disabled={isPending}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === REMOVE_MEMBER_VALUE) {
                          onRemove(member);
                          return;
                        }
                        onChangeRole(member, value as LedgerRole);
                      }}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                      <option value={REMOVE_MEMBER_VALUE}>移除</option>
                    </select>
                  ) : (
                    <span className={styles.roleTag}>{ROLE_LABEL[member.role]}</span>
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

        {virtualMembers.map((person) => (
          <li className={styles.item} key={person.id}>
            <div className={styles.row}>
              <div className={styles.who}>
                <span className={styles.name}>{person.name}</span>
                <span className={styles.personMeta}>
                  <span className={styles.virtualTag}>虛擬成員</span>
                  {pointerNames[person.id] && (
                    <span className={styles.pointer}>→ {pointerNames[person.id]}</span>
                  )}
                </span>
              </div>
              {canManageVirtualMembers && (
                <div className={styles.right}>
                  <button
                    type="button"
                    className={styles.action}
                    aria-label={`改名${person.name}`}
                    onClick={() => onRenameVirtualMember(person)}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.danger}`}
                    aria-label={`刪除${person.name}`}
                    onClick={() => onDeleteVirtualMember(person)}
                  >
                    刪除
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {currentMember && !isArchived && (
        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            disabled={currentMember.userId === pendingUserId}
            onClick={() => onLeave(currentMember)}
          >
            退出帳本
          </button>
        </div>
      )}
    </>
  );
}
