import { MemberFields } from './MemberFields';
import { newParticipant, type MemberDraft } from './participant-draft';
import styles from './LedgerParticipants.module.css';

interface LedgerParticipantsProps {
  value: MemberDraft[];
  onChange: (next: MemberDraft[]) => void;
  disabled?: boolean;
}

/**
 * 建立共享帳本時，要一併加進來的人。
 *
 * 這個元件擁有**清單**——增列、刪列、顯示每列的結果。它是穩定的部分；未來加好友挑選
 * 或邀請連結時，換掉的是「怎麼產生一列」（`MemberFields`），清單本身不動。
 * 決議見 `tasks/phase-2b-slice-2-plan.md` D10。
 *
 * 可以一位都不填。共享帳本允許先建立、之後再加人（2d 決策 5）——對方也許還沒註冊，
 * 不該因此卡住建立。
 */
export function LedgerParticipants({ value, onChange, disabled }: LedgerParticipantsProps) {
  function update(index: number, next: MemberDraft) {
    onChange(value.map((item, i) => (i === index ? next : item)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>參與者</legend>
      <p className={styles.hint}>
        輸入對方註冊時使用的 email。對方還沒註冊的話，可以先建立帳本，之後再加。
      </p>

      {value.map((participant, index) => (
        <div className={styles.row} key={participant.key}>
          <MemberFields
            value={participant}
            position={index + 1}
            disabled={disabled}
            onChange={(next) => update(index, next)}
          />
          <button
            type="button"
            className={styles.remove}
            disabled={disabled}
            onClick={() => remove(index)}
            aria-label={`移除參與者 ${index + 1}`}
          >
            移除
          </button>
          {/* 每一列各自顯示自己的失敗原因。整份表單共用一個錯誤框的話，
              使用者看得到「查無此使用者」卻不知道是哪一位。 */}
          {participant.error && (
            <p className={styles.error} role="alert">
              {participant.error}
            </p>
          )}
        </div>
      ))}

      <button
        type="button"
        className={styles.add}
        disabled={disabled}
        onClick={() => onChange([...value, newParticipant()])}
      >
        + 再加一位
      </button>
    </fieldset>
  );
}
