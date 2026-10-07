import { useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/use-current-user';
import { AnimatedDisclosure } from '../debts/AnimatedDisclosure';
import type { SettlementPrefill } from '../transactions/TransactionWorkbench';
import { SettlementForm } from './SettlementForm';
import { useSettlementSummary } from './use-settlements';
import styles from './SettlementView.module.css';

interface SettlementViewProps {
  ledger: LedgerSummary;
  activeSuggestionKey?: string | null;
  onActiveSuggestionChange?: (key: string | null, prefill?: SettlementPrefill) => void;
  externalPrefill?: SettlementPrefill | null;
  /** 當外部未控制展開狀態時的相容回呼 */
  onSettle?: (prefill: SettlementPrefill) => void;
}

/**
 * 共享帳本的轉帳建議清單。
 *
 * ## 為什麼拿掉淨額卡片與獨立的「結清」按鈕（debts-tabs2）
 *
 * 原型簡化：使用者關注的是「誰該轉給誰多少錢」。點擊整條轉帳列直接在下方展開
 * 預填好的結清表單，送出或取消後自動收起。VIEWER 角色不可點擊操作。
 */
export function SettlementView({
  ledger,
  activeSuggestionKey,
  onActiveSuggestionChange,
  externalPrefill,
  onSettle,
}: SettlementViewProps) {
  const summary = useSettlementSummary(ledger.id, ledger.kind === 'SHARED');
  const currentUser = useCurrentUser();
  const [localActiveKey, setLocalActiveKey] = useState<string | null>(null);
  const [formInstance, setFormInstance] = useState(0);

  const isControlled = activeSuggestionKey !== undefined;
  const currentActiveKey = isControlled ? activeSuggestionKey : localActiveKey;
  const canCreate = ledger.role !== 'VIEWER' && ledger.archivedAt === null;
  const peopleById = new Map<string, { id: string; name: string; userId: string | null }>();
  for (const entry of summary.data?.people ?? []) {
    const person =
      'person' in entry && entry.person
        ? entry.person
        : (entry as { id?: string; name?: string; userId?: string | null });
    if (person.id && person.name) {
      peopleById.set(person.id, {
        id: person.id,
        name: person.name,
        userId: person.userId ?? null,
      });
    }
  }

  function displayName(person: { id: string; name: string; userId: string | null }) {
    return person.userId !== null && person.userId === currentUser.data?.id ? '我' : person.name;
  }

  function toggleSuggestion(key: string, prefill: SettlementPrefill) {
    if (!canCreate) {
      return;
    }
    const nextKey = currentActiveKey === key ? null : key;
    setFormInstance((prev) => prev + 1);
    if (isControlled) {
      onActiveSuggestionChange?.(nextKey, prefill);
    } else {
      setLocalActiveKey(nextKey);
    }
    if (nextKey !== null) {
      onSettle?.(prefill);
    }
  }

  function handleCloseForm() {
    if (isControlled) {
      onActiveSuggestionChange?.(null);
    } else {
      setLocalActiveKey(null);
    }
  }

  return (
    <div className={styles.view}>
      {summary.isLoading && <p className={styles.status}>載入中…</p>}
      {summary.error && <FormError error={summary.error} />}
      {summary.data && (
        <>
          {summary.data.suggestions.length === 0 ? (
            <p className={styles.settled}>兩清</p>
          ) : (
            <section className={styles.section} aria-label="轉帳">
              <ul className={styles.suggestionList}>
                {summary.data.suggestions.map((suggestion, index) => {
                  const from = peopleById.get(suggestion.fromPersonId);
                  const to = peopleById.get(suggestion.toPersonId);
                  if (!from || !to) {
                    return null;
                  }

                  const fromName = displayName(from);
                  const toName = displayName(to);
                  const suggestionKey = `${suggestion.fromPersonId}-${suggestion.toPersonId}`;
                  const expanded = currentActiveKey === suggestionKey;
                  const formId = `settlement-form-${ledger.id}-${index}`;
                  const defaultPrefill: SettlementPrefill = {
                    fromPersonId: suggestion.fromPersonId,
                    toPersonId: suggestion.toPersonId,
                    amount: suggestion.amount,
                  };

                  return (
                    <li key={suggestionKey} className={styles.suggestionItem}>
                      {canCreate ? (
                        <button
                          type="button"
                          className={styles.suggestionRow}
                          aria-expanded={expanded}
                          aria-controls={formId}
                          onClick={() => toggleSuggestion(suggestionKey, defaultPrefill)}
                        >
                          <DebtArrow
                            from={fromName}
                            to={toName}
                            amount={suggestion.amount}
                            srText={`${fromName}欠${toName} ${formatMoney(suggestion.amount)}`}
                          />
                        </button>
                      ) : (
                        <div className={`${styles.suggestionRow} ${styles.readOnly}`}>
                          <DebtArrow
                            from={fromName}
                            to={toName}
                            amount={suggestion.amount}
                            srText={`${fromName}欠${toName} ${formatMoney(suggestion.amount)}`}
                          />
                        </div>
                      )}

                      {canCreate && (
                        <AnimatedDisclosure id={formId} open={expanded}>
                          <div className={styles.formContainer}>
                            <SettlementForm
                              key={formInstance}
                              ledger={ledger}
                              prefill={externalPrefill ?? defaultPrefill}
                              onSaved={handleCloseForm}
                              onDeleted={handleCloseForm}
                            />
                            <div className={styles.formActions}>
                              <Button type="button" variant="secondary" onClick={handleCloseForm}>
                                取消
                              </Button>
                            </div>
                          </div>
                        </AnimatedDisclosure>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
