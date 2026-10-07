import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/Button';
import styles from './AddMemberMenu.module.css';

interface AddMemberMenuProps {
  onAddCounterparty: () => void;
  onAddVirtualMember: () => void;
}

/** 帳本成員只有一個新增入口；選擇來源後才開對應的表單。 */
export function AddMemberMenu({ onAddCounterparty, onAddVirtualMember }: AddMemberMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const optionsId = useId();

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;

    const updatePreference = () => setReducedMotion(query.matches);
    query.addEventListener?.('change', updatePreference);
    return () => query.removeEventListener?.('change', updatePreference);
  }, []);

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
        data-reduced-motion={reducedMotion}
        style={{ transitionDuration: reducedMotion ? '0ms' : undefined }}
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
