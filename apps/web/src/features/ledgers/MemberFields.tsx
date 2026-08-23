import type { LedgerRole } from '@ledger/shared';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import type { MemberDraft } from './participant-draft';

interface MemberFieldsProps {
  value: MemberDraft;
  onChange: (next: MemberDraft) => void;
  /** 這是第幾位參與者（從 1 起算），用於欄位標籤。 */
  position: number;
  disabled?: boolean;
}

/**
 * 一位成員的 email 與角色欄位。
 *
 * 這是**未來會被換掉或並列的部分**：好友挑選、邀請連結做出來之後，改的是「怎麼產生
 * 一列」，`LedgerParticipants` 持有的清單本身不動（見 `tasks/phase-2b-slice-2-plan.md`
 * D10）。Step 6 的「新增成員」彈窗也重用這個元件。
 *
 * **角色只給 EDITOR 與 VIEWER。** owner 能封存、刪除、改成員角色，在快速填寫的表單裡
 * 誤選代價太大。要給 owner 請到成員管理頁明確變更。
 *
 * 每一列的標籤都帶著序號（「參與者 2 的 email」），多列並存時螢幕閱讀器才分得出
 * 現在在填哪一位——測試也靠它定位。
 */
export function MemberFields({ value, onChange, position, disabled }: MemberFieldsProps) {
  return (
    <>
      <TextField
        label={`參與者 ${position} 的 email`}
        type="email"
        value={value.email}
        disabled={disabled}
        placeholder="someone@example.com"
        onChange={(event) => onChange({ ...value, email: event.target.value })}
      />
      <Select
        label={`參與者 ${position} 的角色`}
        value={value.role}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, role: event.target.value as LedgerRole })}
      >
        <option value="EDITOR">可編輯</option>
        <option value="VIEWER">唯讀</option>
      </Select>
    </>
  );
}
