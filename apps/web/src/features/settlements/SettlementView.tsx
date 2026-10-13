import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { getAvatarLabels } from '../../lib/avatar-labels';
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
 * 斷點：寬螢幕為兩欄、窄螢幕（≤ 640px / 40rem）為一欄。
 * 斷點數值與 SettlementView.module.css 的媒體查詢保持一致。
 */
const NARROW_SCREEN_QUERY = '(max-width: 40rem)';

function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(NARROW_SCREEN_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(NARROW_SCREEN_QUERY);
    const update = () => setIsNarrow(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    } else if (typeof media.addListener === 'function') {
      media.addListener(update);
      return () => media.removeListener(update);
    }
  }, []);

  return isNarrow;
}

/**
 * 取得當前環境的面板開合過渡時間。
 *
 * 在設定關閉動畫或 jsdom 測試環境下直接回傳 0，避免非必要的定時器延遲。
 */
function getMotionDurationMs(): number {
  if (typeof window === 'undefined' || !window.getComputedStyle) {
    return 0;
  }
  if (document.documentElement.getAttribute('data-motion') === 'off') {
    return 0;
  }
  const style = window.getComputedStyle(document.documentElement);
  const motionPanel = style.getPropertyValue('--motion-panel').trim();
  if (!motionPanel) {
    return 0;
  }
  const num = Number.parseFloat(motionPanel);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const durationMs = motionPanel.endsWith('ms') ? num : motionPanel.endsWith('s') ? num * 1000 : 0;
  return durationMs + 32;
}

/**
 * 共享帳本的轉帳建議檢視（shared-tiles 方塊格版）。
 *
 * ## 為什麼改成方塊格與全寬展開
 *
 * 原本一列一條轉帳在卡片內顯得過於空曠；改成方塊格後，每塊置中呈現轉帳大箭頭，
 * 寬螢幕一排兩欄、窄螢幕一排單欄。點擊方塊時，結清表單不在方塊內擠壓，而是以
 * `grid-column: 1 / -1` 橫跨整排卡片寬度，插入在該排方塊的正下方。
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
  const [prevActiveKey, setPrevActiveKey] = useState<string | null>(null);
  const [displayedKey, setDisplayedKey] = useState<string | null>(null);
  const [formInstance, setFormInstance] = useState(0);
  const isNarrow = useIsNarrowScreen();

  const isControlled = activeSuggestionKey !== undefined;
  const currentActiveKey = isControlled ? activeSuggestionKey : localActiveKey;
  const canCreate = ledger.role !== 'VIEWER' && ledger.archivedAt === null;

  // 當展開目標改變時，於渲染期同步記錄最後選中的方塊 key；收起時保留供收合動畫使用
  if (currentActiveKey !== prevActiveKey) {
    setPrevActiveKey(currentActiveKey);
    if (currentActiveKey !== null) {
      setDisplayedKey(currentActiveKey);
    }
  }

  useEffect(() => {
    if (currentActiveKey !== null) {
      return;
    }
    const delay = getMotionDurationMs();
    const timer = window.setTimeout(() => {
      setDisplayedKey(null);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentActiveKey]);

  const peopleById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; userId: string | null }>();
    for (const entry of summary.data?.people ?? []) {
      const person =
        'person' in entry && entry.person
          ? entry.person
          : (entry as { id?: string; name?: string; userId?: string | null });
      if (person.id && person.name) {
        map.set(person.id, {
          id: person.id,
          name: person.name,
          userId: person.userId ?? null,
        });
      }
    }
    return map;
  }, [summary.data?.people]);

  const displayName = useCallback(
    (person: { id: string; name: string; userId: string | null }) => {
      return person.userId !== null && person.userId === currentUser.data?.id ? '我' : person.name;
    },
    [currentUser.data?.id],
  );

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

  const validSuggestions = useMemo(() => {
    return (summary.data?.suggestions ?? []).flatMap((suggestion) => {
      const from = peopleById.get(suggestion.fromPersonId);
      const to = peopleById.get(suggestion.toPersonId);
      if (!from || !to) {
        return [];
      }
      return [
        {
          suggestion,
          from,
          to,
          fromName: displayName(from),
          toName: displayName(to),
          key: `${suggestion.fromPersonId}-${suggestion.toPersonId}`,
          defaultPrefill: {
            fromPersonId: suggestion.fromPersonId,
            toPersonId: suggestion.toPersonId,
            amount: suggestion.amount,
          },
        },
      ];
    });
  }, [displayName, peopleById, summary.data?.suggestions]);

  // 同一張帳本卡片裡的頭貼字不衝突（小明／小華 → 明／華），規則同借還頁的 avatar-labels。
  const avatarLabels = useMemo(
    () => getAvatarLabels(validSuggestions.flatMap((item) => [item.fromName, item.toName])),
    [validSuggestions],
  );

  const activeKeyToRender = currentActiveKey ?? displayedKey;
  const activeIndex = validSuggestions.findIndex((item) => item.key === activeKeyToRender);
  const activeItem = activeIndex >= 0 ? validSuggestions[activeIndex] : null;
  const isFormOpen = currentActiveKey !== null && currentActiveKey === activeItem?.key;

  // 依據寬度計算每排欄數，決定表單橫跨列要插在第幾個項目後面（該排最後一個方塊之後）
  const columnCount = isNarrow ? 1 : 2;
  const insertAfterIndex =
    activeItem !== null
      ? Math.min(
          validSuggestions.length - 1,
          Math.floor(activeIndex / columnCount) * columnCount + (columnCount - 1),
        )
      : -1;

  return (
    <div className={styles.view}>
      {summary.isLoading && <p className={styles.status}>載入中…</p>}
      {summary.error && <FormError error={summary.error} />}
      {summary.data && (
        <>
          {summary.data.suggestions.length === 0 || validSuggestions.length === 0 ? (
            <p className={styles.settled}>兩清</p>
          ) : (
            <section className={styles.section} aria-label="轉帳">
              <ul className={styles.suggestionGrid}>
                {validSuggestions.map((item, index) => {
                  const isThisExpanded = currentActiveKey === item.key;
                  const formId = `settlement-form-${ledger.id}-${index}`;
                  const shouldInsertFormHere =
                    canCreate && activeItem !== null && index === insertAfterIndex;
                  const activeFormId = `settlement-form-${ledger.id}-${activeIndex}`;

                  return (
                    <Fragment key={item.key}>
                      <li className={styles.tileItem}>
                        {canCreate ? (
                          <button
                            type="button"
                            className={[
                              styles.tile,
                              styles.tileButton,
                              isThisExpanded ? styles.selected : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-expanded={isThisExpanded}
                            aria-controls={formId}
                            onClick={() => toggleSuggestion(item.key, item.defaultPrefill)}
                          >
                            <DebtArrow
                              from={item.fromName}
                              to={item.toName}
                              fromLabel={avatarLabels.get(item.fromName)}
                              toLabel={avatarLabels.get(item.toName)}
                              amount={item.suggestion.amount}
                              srText={`${item.fromName}欠${item.toName} ${formatMoney(item.suggestion.amount)}`}
                            />
                          </button>
                        ) : (
                          <div className={`${styles.tile} ${styles.readOnly}`}>
                            <DebtArrow
                              from={item.fromName}
                              to={item.toName}
                              fromLabel={avatarLabels.get(item.fromName)}
                              toLabel={avatarLabels.get(item.toName)}
                              amount={item.suggestion.amount}
                              srText={`${item.fromName}欠${item.toName} ${formatMoney(item.suggestion.amount)}`}
                            />
                          </div>
                        )}
                      </li>

                      {shouldInsertFormHere && activeItem && (
                        <li key={`form-row-${activeItem.key}`} className={styles.formRow}>
                          <AnimatedDisclosure id={activeFormId} open={isFormOpen}>
                            <div className={styles.formContainer}>
                              <SettlementForm
                                key={formInstance}
                                ledger={ledger}
                                prefill={externalPrefill ?? activeItem.defaultPrefill}
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
                        </li>
                      )}
                    </Fragment>
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
