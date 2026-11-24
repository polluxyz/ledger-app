import { useEffect, useRef, useState } from 'react';
import {
  countStatsFilters,
  EMPTY_STATS_FILTERS,
  FILTER_ID_KEYS,
  type FilterKey,
  type FilterLists,
  type StatsFilters,
} from './statistics-filters';
import styles from './StatisticsFilter.module.css';

const GROUP_LABELS = { personIds: '成員', categoryIds: '分類', accountIds: '帳戶' };
const FLAG_LABELS = { includeUncategorized: '未分類', includeOtherAccounts: '其他' };
const GROUP_FLAGS = {
  personIds: undefined,
  categoryIds: 'includeUncategorized',
  accountIds: 'includeOtherAccounts',
} as const;

interface FilterProps {
  filters: StatsFilters;
  lists: FilterLists;
  onChange: (filters: StatsFilters) => void;
}

function toggleOption(filters: StatsFilters, key: FilterKey, id?: string): StatsFilters {
  if (key === 'includeUncategorized' || key === 'includeOtherAccounts') {
    return { ...filters, [key]: !filters[key] };
  }
  if (id === undefined) return filters;
  const ids = filters[key];
  return {
    ...filters,
    [key]: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
  };
}

/** 編輯暫存的條件，按套用後才更新網址。 */
export function StatisticsFilter({
  filters,
  lists,
  onChange,
  showPeople,
}: FilterProps & { showPeople: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<StatsFilters | null>(null);
  const count = countStatsFilters(filters);
  const open = draft !== null;

  useEffect(() => {
    const panel = dialog.current;
    const button = trigger.current;
    if (!open || !panel || !button) return;

    const positionPanel = () => {
      const anchor = button.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom;
      const above = below < 320 && anchor.top > below;
      panel.style.setProperty('--filter-left', `${anchor.left}px`);
      panel.style.setProperty('--filter-top', above ? 'auto' : `${anchor.bottom + 8}px`);
      panel.style.setProperty(
        '--filter-bottom',
        above ? `${window.innerHeight - anchor.top + 8}px` : 'auto',
      );
      panel.style.setProperty('--filter-space', `${(above ? anchor.top : below) - 16}px`);
    };
    positionPanel();
    panel.showModal();
    panel.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
    window.addEventListener('resize', positionPanel);
    return () => window.removeEventListener('resize', positionPanel);
  }, [open]);

  function close() {
    dialog.current?.close();
    setDraft(null);
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        className={styles.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? `篩選，已選 ${count} 項` : '篩選'}
        onClick={() => setDraft(filters)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 5h18l-7 8v5l-4 2v-7z" />
        </svg>
        {count > 0 && <span className={styles.count}>{count}</span>}
      </button>
      {draft && (
        <dialog
          ref={dialog}
          aria-label="篩選"
          className={styles.dialog}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className={styles.content}>
            <h2>篩選</h2>
            <div className={styles.options}>
              {FILTER_ID_KEYS.map((key) => {
                const flag = GROUP_FLAGS[key];
                if (key === 'personIds' && !showPeople) return null;
                return (
                  <fieldset key={key}>
                    <legend>{GROUP_LABELS[key]}</legend>
                    {lists[key]?.map(({ id, name }) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={draft[key].includes(id)}
                          disabled={draft[key].length >= 50 && !draft[key].includes(id)}
                          onChange={() => setDraft(toggleOption(draft, key, id))}
                        />
                        {name}
                      </label>
                    ))}
                    {flag && (
                      <label>
                        <input
                          type="checkbox"
                          checked={draft[flag]}
                          onChange={() => setDraft(toggleOption(draft, flag))}
                        />
                        {FLAG_LABELS[flag]}
                      </label>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => {
                  close();
                  onChange(EMPTY_STATS_FILTERS);
                }}
              >
                清除全部
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onChange(draft);
                }}
              >
                套用
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

/** 顯示網址已套用的條件，按標籤立即移除該項。 */
export function StatisticsFilterTags({ filters, lists, onChange }: FilterProps) {
  if (!countStatsFilters(filters)) return null;

  function tag(key: FilterKey, label: string, id?: string) {
    return (
      <li key={`${key}:${id ?? ''}`}>
        <button
          type="button"
          aria-label={`移除${label}`}
          onClick={() => onChange(toggleOption(filters, key, id))}
        >
          {label} <span aria-hidden="true">×</span>
        </button>
      </li>
    );
  }

  return (
    <ul className={styles.tags} aria-label="已套用的篩選">
      {FILTER_ID_KEYS.flatMap((key) => {
        const flag = GROUP_FLAGS[key];
        const tags = filters[key].map((id) =>
          tag(key, lists[key]?.find((item) => item.id === id)?.name ?? id, id),
        );
        if (flag && filters[flag]) tags.push(tag(flag, FLAG_LABELS[flag]));
        return tags;
      })}
    </ul>
  );
}
