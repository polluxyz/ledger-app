import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { Counterparty } from '@ledger/shared';
import { TextField } from '../../components/TextField';
import { formatMoney } from '../../lib/format';
import { useCounterparties } from './use-debts';
import styles from './CounterpartyPicker.module.css';

interface CounterpartyPickerProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (counterparty: Counterparty | null) => void;
  excludeLinked?: boolean;
  label?: string;
  hint?: string;
}

/**
 * 選人清單直接呈現 API 的查詢結果，輸入停止後才送出篩選，讓名字比對規則留在後端。
 * 選定後才把對象回報給表單；清單本身只協助找人，不混入餘額資訊。
 */
export function CounterpartyPicker({
  value,
  onChange,
  onSelect,
  excludeLinked = false,
  label = '對象',
  hint,
}: CounterpartyPickerProps) {
  const listId = `counterparties-${useId()}`;
  const normalizedValue = value.trim();
  const [isOpen, setIsOpen] = useState(false);
  const [requestedActiveIndex, setActiveIndex] = useState(-1);
  const [debouncedValue, setDebouncedValue] = useState('');

  // 把前後空白先收掉再等候，後端收到的 q 才會與畫面上的名字一致。
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(normalizedValue), 300);
    return () => window.clearTimeout(timeout);
  }, [normalizedValue]);

  const query = useCounterparties({
    ...(debouncedValue === '' ? {} : { q: debouncedValue }),
    limit: 50,
  });
  // query hook 保留上一筆結果時先不拿來選，避免輸入新名字後仍能點到舊清單的人。
  const hasCurrentResults = normalizedValue === debouncedValue && !query.isPlaceholderData;
  const responseItems = hasCurrentResults ? (query.data?.items ?? []) : [];
  const counterparties = excludeLinked
    ? responseItems.filter((counterparty) => counterparty.link === null)
    : responseItems;
  const exactMatch = findCounterparty(normalizedValue, counterparties);
  // 查詢結果還沒追上輸入時先不提供「新增」，否則打既有的名字會短暫閃過「新增」與「新對象」。
  const canAddName = hasCurrentResults && normalizedValue !== '' && exactMatch === null;
  const optionCount = counterparties.length + (canAddName ? 1 : 0);
  const activeIndex = requestedActiveIndex < optionCount ? requestedActiveIndex : -1;
  const activeOptionId =
    activeIndex >= 0 && activeIndex < counterparties.length
      ? `${listId}-${counterparties[activeIndex]!.id}`
      : activeIndex === counterparties.length && canAddName
        ? `${listId}-new`
        : '';
  const showMoreHint =
    hasCurrentResults && (query.data?.total ?? 0) > (query.data?.items.length ?? 0);

  function selectExisting(counterparty: Counterparty) {
    onChange(counterparty.name);
    onSelect?.(counterparty);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function selectNewName() {
    onChange(normalizedValue);
    onSelect?.(null);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      if (optionCount === 0) {
        setActiveIndex(-1);
        return;
      }
      setActiveIndex(
        activeIndex < 0
          ? event.key === 'ArrowDown'
            ? 0
            : optionCount - 1
          : event.key === 'ArrowDown'
            ? (activeIndex + 1) % optionCount
            : (activeIndex - 1 + optionCount) % optionCount,
      );
      return;
    }

    if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      event.preventDefault();
      if (activeIndex < counterparties.length) {
        selectExisting(counterparties[activeIndex]!);
      } else if (canAddName && activeIndex === counterparties.length) {
        selectNewName();
      }
    }
  }

  const balanceHint = excludeLinked
    ? null
    : exactMatch
      ? exactMatch.balance > 0
        ? `目前${exactMatch.name}欠你 ${formatMoney(exactMatch.balance)}`
        : exactMatch.balance < 0
          ? `目前你欠${exactMatch.name} ${formatMoney(Math.abs(exactMatch.balance))}`
          : `目前和${exactMatch.name}兩清`
      : canAddName
        ? '新對象，送出時建立'
        : null;

  return (
    <div className={styles.picker}>
      <TextField
        label={label}
        value={value}
        hint={hint}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          onSelect?.(null);
          setActiveIndex(-1);
          setIsOpen(true);
        }}
      />

      <ul
        className={styles.options}
        id={listId}
        role="listbox"
        aria-label={`${label}選項`}
        hidden={!isOpen}
      >
        {counterparties.map((counterparty, index) => (
          <li
            key={counterparty.id}
            id={`${listId}-${counterparty.id}`}
            className={`${styles.option} ${activeIndex === index ? styles.active : ''}`}
            role="option"
            aria-selected={activeIndex === index}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActiveIndex(index)}
            onClick={() => selectExisting(counterparty)}
          >
            <span>{counterparty.name}</span>
            {counterparty.link !== null && <span className={styles.linkBadge}>連動</span>}
          </li>
        ))}

        {canAddName && (
          <li
            id={`${listId}-new`}
            className={`${styles.option} ${styles.addOption} ${activeIndex === counterparties.length ? styles.active : ''}`}
            role="option"
            aria-selected={activeIndex === counterparties.length}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActiveIndex(counterparties.length)}
            onClick={selectNewName}
          >
            ＋ 新增「{normalizedValue}」
          </li>
        )}

        {showMoreHint && (
          <li
            className={`${styles.option} ${styles.moreHint}`}
            role="option"
            aria-disabled="true"
            aria-selected="false"
          >
            繼續輸入以縮小範圍
          </li>
        )}
      </ul>

      {balanceHint && (
        <p className={styles.balanceHint} role="status">
          {balanceHint}
        </p>
      )}
    </div>
  );
}

/**
 * 完整名字比對只用來分辨「既有對象」與「新增名字」；比對資料仍來自 API，前端不篩選查詢結果。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function findCounterparty(
  name: string,
  counterparties: Counterparty[],
): Counterparty | null {
  const normalizedName = name.trim();
  return normalizedName === ''
    ? null
    : (counterparties.find((counterparty) => counterparty.name === normalizedName) ?? null);
}
