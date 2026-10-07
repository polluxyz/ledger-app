import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import styles from './AddMemberMenu.module.css';

interface AddMemberMenuProps {
  onAddCounterparty: () => void;
  onAddVirtualMember: () => void;
}

/**
 * 帳本成員只有一個新增入口；選擇來源後才開對應的表單（3f W143）。
 *
 * 滑出動畫只用 `--motion-*` token。站內關掉動畫（`data-motion='off'`）時 token 歸零，
 * 選項直接出現；不看作業系統的 `prefers-reduced-motion`（見 `global.css` 的說明）。
 */
export function AddMemberMenu({ onAddCounterparty, onAddVirtualMember }: AddMemberMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();

  function choose(action: () => void) {
    setExpanded(false);
    action();
  }

  return (
    <div className={styles.menu}>
      <Button
        variant="secondary"
        aria-expanded={expanded}
        aria-controls={optionsId}
        onClick={() => setExpanded((isExpanded) => !isExpanded)}
      >
        新增成員
      </Button>
      <div
        className={`${styles.options} ${expanded ? styles.expanded : ''}`}
        id={optionsId}
        role="group"
        aria-label="新增方式"
        aria-hidden={!expanded}
      >
        <div className={styles.inner}>
          <Button
            variant="secondary"
            disabled={!expanded}
            tabIndex={expanded ? 0 : -1}
            onClick={() => choose(onAddCounterparty)}
          >
            新增對象
          </Button>
          <Button
            variant="secondary"
            disabled={!expanded}
            tabIndex={expanded ? 0 : -1}
            onClick={() => choose(onAddVirtualMember)}
          >
            新增虛擬成員
          </Button>
        </div>
      </div>
    </div>
  );
}
