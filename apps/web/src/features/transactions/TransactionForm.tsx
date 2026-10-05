import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import {
  centsToInput,
  computeSplitShares,
  computeSharesByKey,
  fillRemainingShares,
  isDebtTransactionType,
  parseMoneyInput,
  type Category,
  type CategoryType,
  type CreateTransactionRequest,
  type CreateSplitRequest,
  type Counterparty,
  type LedgerPerson,
  type LedgerSummary,
  type ManualTransactionType,
  type Split,
  type SplitMethod,
  type SplitParticipantInput,
  type SplitPrecision,
  type SplitType,
  type Transaction,
  type UpdateSplitRequest,
  type UpdateTransactionRequest,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { CategoryIcon } from '../../components/CategoryIcon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatMoney, toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { useCurrentUser } from '../auth/use-current-user';
import { useCategories } from '../categories/use-categories';
import { DebtEntryForm } from '../debts/DebtEntryForm';
import { useCreateCounterparty } from '../debts/use-debts';
import { useCreateLedgerPerson, useLedgerPeople } from '../ledger-people/use-ledger-people';
import {
  createDefaultLedgerSplitPeople,
  restoreLedgerSplitPeople,
  toLedgerSplitInput,
} from './ledger-split-form';
import { PaymentRow } from './PaymentRow';
import { LedgerSplitSection } from './LedgerSplitSection';
import { SplitOptionsView } from './SplitOptionsView';
import { SplitSection } from './SplitSection';
import {
  fillRemainingSharesByKey,
  SPLIT_ME_KEY,
  type SplitParticipantDraft,
  splitPreviewCounterpartyId,
} from './split-form';
import { useCreateSplit, useDeleteSplit, useUpdateSplit } from './use-splits';
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from './use-transactions';
import styles from './TransactionForm.module.css';
import fieldStyles from '../../components/TextField.module.css';

/** 新增模式的分段控制多一格「借還」：它不是交易型別，只是改渲染 DebtEntryForm。 */
type EntryTab = ManualTransactionType | 'DEBT';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
}

/** 分類選單用按鈕列出圖示與名稱，原生 select 的 option 無法顯示 lucide 圖示。 */
function CategoryPicker({ categories, value, onChange }: CategoryPickerProps) {
  const pickerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedCategory = categories.find((category) => category.id === value);

  function handleOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className={`${fieldStyles.field} ${styles.categoryField}`}>
      <span className={fieldStyles.label}>分類</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`${fieldStyles.input} ${styles.categoryTrigger}`}
        aria-label="分類"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={pickerId}
        aria-valuetext={selectedCategory?.name ?? '請選擇分類'}
        onClick={() => setIsOpen((current) => !current)}
      >
        <CategoryIcon icon={selectedCategory?.icon} size={16} />
        <span className={styles.categoryValue}>{selectedCategory?.name ?? '請選擇分類'}</span>
        <ChevronDown aria-hidden="true" className={styles.categoryChevron} size={16} />
      </button>
      {isOpen && (
        <div
          id={pickerId}
          role="listbox"
          aria-label="分類"
          className={styles.categoryOptions}
          onKeyDown={handleOptionsKeyDown}
        >
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={category.id === value}
              className={styles.categoryOption}
              onClick={() => {
                onChange(category.id);
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <CategoryIcon icon={category.icon} size={16} />
              <span className={styles.categoryValue}>{category.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TransactionFormProps {
  ledger: LedgerSummary;
  /** 有值＝編輯模式，欄位預填這一筆。 */
  transaction?: Transaction;
  /** 有值＝透過分帳端點編輯；會從 API 回應還原完整名單與分法。 */
  split?: Split;
  /** 編輯成功後呼叫（通常用來關閉彈窗）。新增模式不會呼叫。 */
  onSaved?: () => void;
  /**
   * 編輯模式的「取消」。有傳才渲染那顆按鈕——新增表單是常駐的，沒有「取消」
   * 可言（phase-2h · D9）。
   */
  onCancel?: () => void;
  /**
   * 金額欄位的 `id`。右側欄要在「＋ 新增交易」被按下時把焦點送到金額欄
   * （spec 2i SC-35.3），但 `TextField` 不轉發 ref，所以改用呼叫端指定的 id
   * 去 `document.getElementById` 找它。不傳就沿用 `useId` 產生的值。
   */
  amountFieldId?: string;
  /** 新增表單從某個對象的往來帳開啟時，預先切到借還並帶入對象名字。 */
  initialDebtCounterparty?: string;
}

/**
 * 記一筆交易的表單，新增與編輯共用。
 *
 * 輸入框顯示以元為單位的字串；送出前由 shared 將字串解析成整數分，讓畫面與 API
 * 使用各自清楚的單位。
 *
 * 前端只做「體驗性」的必填與型別限制（required、type="number"）；真正的驗證
 * 一律由後端負責。失敗時訊息的內容仍來自後端，前端只把 `errorCode` 換成
 * 在地化字串（`lib/error-messages.ts`），對不到的代碼就原樣顯示。
 *
 * ## 為什麼新增與編輯是同一個元件（D1）
 *
 * 欄位規則有四種組合（型別 × 帳本的 `tracksBalance`，表在
 * `packages/shared/src/types/transaction.ts`）。這種規則只該有一份實作。
 * 分成兩個表單一開始好寫，但兩邊遲早分岔，而分岔的症狀是「新增得成、編輯卻被
 * 後端 400」——很難聯想到原因。
 *
 * ## 為什麼收的是整個 `ledger` 而不只是 id（SC-16）
 *
 * 帳戶欄位存不存在，取決於這本帳本的 `tracksBalance`：
 *
 * - **連動帳本**：帳戶必填，不給就是 400 `ACCOUNT_REQUIRED`。
 * - **非連動帳本**：帳戶不可給，給了就是 400 `ACCOUNT_NOT_ALLOWED`。
 *
 * 所以欄位不能只是「停用」，必須整個不存在，送出的 body 也不能帶 `accountId`。
 *
 * ## 新增模式的第 4 格「借還」（3b-1 · W2）
 *
 * 選了「借還」，下面的欄位換成 `DebtEntryForm`（借出／借入／還款）。借還交易
 * 不能進編輯表單（後端 409 `DEBT_TRANSACTION_READ_ONLY`），所以那一格只在
 * 新增模式出現。
 */
export function TransactionForm({ ledger, transaction, split, ...props }: TransactionFormProps) {
  const hasLegacySplit = split !== undefined || transaction?.split != null;
  if (ledger.kind === 'SHARED' && !hasLegacySplit) {
    return (
      <SharedLedgerTransactionForm
        ledger={ledger}
        transaction={transaction}
        split={split}
        {...props}
      />
    );
  }

  return (
    <TransactionFormContent
      ledger={ledger}
      transaction={transaction}
      split={split}
      isSharedLedger={false}
      sharedPeople={undefined}
      sharedCurrentUserId={null}
      sharedLoadPending={false}
      createLedgerPerson={undefined}
      {...props}
    />
  );
}

interface TransactionFormContentProps extends TransactionFormProps {
  isSharedLedger: boolean;
  sharedPeople: LedgerPerson[] | undefined;
  sharedCurrentUserId: string | null;
  sharedLoadPending: boolean;
  createLedgerPerson: ReturnType<typeof useCreateLedgerPerson> | undefined;
}

/** 共享帳本才查詢自己與帳本名單，讓個人帳本不新增請求也不改表單路徑。 */
function SharedLedgerTransactionForm(props: TransactionFormProps) {
  const currentUser = useCurrentUser();
  const ledgerPeople = useLedgerPeople(props.ledger.id);
  const createLedgerPerson = useCreateLedgerPerson(props.ledger.id);

  return (
    <TransactionFormContent
      {...props}
      isSharedLedger
      sharedPeople={ledgerPeople.data}
      sharedCurrentUserId={currentUser.data?.id ?? null}
      sharedLoadPending={ledgerPeople.isLoading || currentUser.isLoading}
      createLedgerPerson={createLedgerPerson}
    />
  );
}

function TransactionFormContent({
  ledger,
  transaction,
  split,
  onSaved,
  onCancel,
  amountFieldId,
  initialDebtCounterparty,
  isSharedLedger,
  sharedPeople,
  sharedCurrentUserId,
  sharedLoadPending,
  createLedgerPerson,
}: TransactionFormContentProps) {
  const ledgerId = ledger.id;
  const isEdit = transaction !== undefined || split !== undefined;

  /**
   * 這張表單只處理使用者自己記得出來的 3 種型別（`ManualTransactionType`）。
   *
   * 借還的 4 種由債務端點產生，一般交易端點連改都不讓改（409
   * `DEBT_TRANSACTION_READ_ONLY`），所以列表也不會替借還交易打開這張表單。
   * 這裡仍然問一次而不是直接斷言型別：斷言只是把編譯器噤聲，真有借還交易被送
   * 進來時會一路送出一個後端必拒的 body；退回「支出」至少是個講得通的狀態。
   */
  const [tab, setTab] = useState<EntryTab>(
    split
      ? split.type
      : transaction && !isDebtTransactionType(transaction.type)
        ? transaction.type
        : !isEdit && initialDebtCounterparty
          ? 'DEBT'
          : 'EXPENSE',
  );
  const [amount, setAmount] = useState(
    split
      ? centsToInput(
          split.payer
            ? (split.participants.find((person) => person.counterpartyId === null)?.share ??
                split.total)
            : split.total,
        )
      : transaction
        ? centsToInput(transaction.amount)
        : '',
  );
  const [date, setDate] = useState(() =>
    toDateInputValue(
      split ? new Date(split.date) : transaction ? new Date(transaction.date) : undefined,
    ),
  );
  const [categoryId, setCategoryId] = useState(
    split?.category.id ?? transaction?.category?.id ?? '',
  );
  const [accountId, setAccountId] = useState(split?.account?.id ?? transaction?.account?.id ?? '');
  const [sharedPayerPersonId, setSharedPayerPersonId] = useState<string | null>(
    transaction?.payer?.id ?? null,
  );
  const [sharedPayerChanged, setSharedPayerChanged] = useState(false);
  const [toAccountId, setToAccountId] = useState(transaction?.toAccount?.id ?? '');
  const [title, setTitle] = useState(split?.title ?? transaction?.title ?? '');
  const [note, setNote] = useState(split?.note ?? transaction?.note ?? '');
  const [paymentMode, setPaymentMode] = useState<'account' | 'counterparty' | 'self'>(() =>
    split?.payer || (isSharedLedger && transaction?.payer)
      ? 'counterparty'
      : ledger.tracksBalance
        ? 'account'
        : 'self',
  );
  const [payerName, setPayerName] = useState(
    split?.payer?.name ?? (isSharedLedger ? transaction?.payer?.name : undefined) ?? '',
  );
  const [selectedPayer, setSelectedPayer] = useState<{
    counterpartyId: string;
    name: string;
  } | null>(split?.payer ?? null);
  const [splitEnabled, setSplitEnabled] = useState(() =>
    isSharedLedger
      ? transaction === undefined && split === undefined
        ? true
        : transaction?.ledgerSplit != null
      : split !== undefined,
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(split?.method ?? 'EQUAL');
  const [splitPrecision, setSplitPrecision] = useState<SplitPrecision>(split?.precision ?? 'CENT');
  const [participants, setParticipants] = useState<SplitParticipantDraft[]>(() =>
    split
      ? withMeRow(
          split.participants.map((person, index) => ({
            key:
              person.counterpartyId ??
              (person.name === null ? SPLIT_ME_KEY : `new:${person.name || index}`),
            counterpartyId: person.counterpartyId,
            name: person.counterpartyId === null ? '我' : (person.name ?? ''),
            isMe: person.counterpartyId === null,
            included: true,
            amountFixed: split.method === 'AMOUNT',
            amountInput: split.method === 'AMOUNT' ? centsToInput(person.share) : '',
            amountValue: person.share,
            ratioFixed: split.method === 'RATIO' && person.ratio !== null,
            ratioInput: person.ratio === null ? '' : centsToInput(person.ratio),
            ratioValue: person.ratio ?? 0,
          })),
        )
      : [makeMeParticipant()],
  );
  const [ledgerSplitParticipants, setLedgerSplitParticipants] = useState<SplitParticipantDraft[]>(
    [],
  );
  const [ledgerSplitReady, setLedgerSplitReady] = useState(!isSharedLedger);
  const [splitOptionsOpen, setSplitOptionsOpen] = useState(false);
  const [deleteSplitOpen, setDeleteSplitOpen] = useState(false);
  const [deleteTransactionOpen, setDeleteTransactionOpen] = useState(false);
  const [splitEditWarningOpen, setSplitEditWarningOpen] = useState(false);
  const [submissionError, setSubmissionError] = useState<unknown>(null);
  const [resolvingNames, setResolvingNames] = useState(false);
  const ledgerSplitInitKey = useRef('');

  /**
   * 「借還」分頁選中時，交易欄位整個不渲染、改渲染 `DebtEntryForm`。對交易
   * 欄位來說，型別仍是原本的 3 種（借還時借用 `EXPENSE`——那些欄位根本不會
   * 畫出來，拿到的資料不會被用到，與轉帳借用分類的寫法同一個道理）。
   */
  const isDebtTab = !isEdit && tab === 'DEBT';
  const type: ManualTransactionType = tab === 'DEBT' ? 'EXPENSE' : tab;

  /**
   * 轉帳沒有分類，但 hook 需要一個型別。這時沿用支出即可——分類欄位根本不會渲染，
   * 拿到的清單不會被用到。
   */
  const categoryType: CategoryType = type === 'TRANSFER' ? 'EXPENSE' : type;
  const categories = useCategories(ledgerId, categoryType);
  const accounts = useAccounts();
  const createTransaction = useCreateTransaction(ledgerId);
  const updateTransaction = useUpdateTransaction(ledgerId);
  const deleteTransaction = useDeleteTransaction(ledgerId);
  const createCounterparty = useCreateCounterparty();
  const createSplit = useCreateSplit();
  const updateSplit = useUpdateSplit();
  const deleteSplit = useDeleteSplit();
  const ledgerPeople = sharedPeople ?? [];
  const mePersonId =
    ledgerPeople.find((person) => person.userId === sharedCurrentUserId)?.id ?? null;

  useEffect(() => {
    if (!isSharedLedger || sharedCurrentUserId === null || sharedPeople === undefined) return;
    const nextInitKey = `${ledgerId}:${transaction?.id ?? 'new'}`;
    if (ledgerSplitInitKey.current === nextInitKey) return;
    ledgerSplitInitKey.current = nextInitKey;

    const savedSplit = transaction?.ledgerSplit ?? null;
    setLedgerSplitParticipants(
      savedSplit
        ? restoreLedgerSplitPeople(sharedPeople, mePersonId, savedSplit)
        : createDefaultLedgerSplitPeople(sharedPeople, mePersonId),
    );
    setSplitEnabled(savedSplit !== null || (transaction === undefined && split === undefined));
    setSplitMethod(savedSplit?.method ?? 'EQUAL');
    setSplitPrecision(savedSplit?.precision ?? 'CENT');
    setLedgerSplitReady(true);
  }, [isSharedLedger, ledgerId, mePersonId, sharedCurrentUserId, sharedPeople, split, transaction]);

  const pending =
    resolvingNames ||
    createCounterparty.isPending ||
    (createLedgerPerson?.isPending ?? false) ||
    sharedLoadPending ||
    !ledgerSplitReady ||
    (split
      ? updateSplit.isPending || deleteSplit.isPending
      : isEdit
        ? updateTransaction.isPending || createSplit.isPending
        : createTransaction.isPending || createSplit.isPending);
  const error =
    submissionError ??
    createLedgerPerson?.error ??
    (split
      ? (updateSplit.error ?? deleteSplit.error)
      : isEdit
        ? (updateTransaction.error ?? createSplit.error)
        : (createTransaction.error ?? createSplit.error));
  const amountCents = parseMoneyInput(amount);
  const hasSyncedSplitEntries =
    split?.participants.some((person) => person.sync === 'SYNCED') ?? false;

  /**
   * 帳戶欄位鎖住＝這筆記在別人的帳戶上（D2）。
   *
   * 連動帳本的交易一定有帳戶，而 `account` 只在「帳戶不屬於目前的檢視者」時才被
   * 遮成 `null`（SC-18）。所以在連動帳本裡 `account === null` 就等於「不是我的」，
   * 不必再去比對建立者是誰。
   *
   * 這種情況下前端根本拿不到原本的帳戶 id，送出時就**不帶 `accountId`**，
   * 後端會沿用原值。若照新增模式那樣「沒選就落到第一個帳戶」，會把別人的交易
   * 悄悄搬到自己的戶頭——而且送得出去，後端不會擋。
   */
  const accountLocked =
    transaction !== undefined &&
    split === undefined &&
    ledger.tracksBalance &&
    transaction.account === null &&
    !(isSharedLedger && (sharedPayerChanged || sharedPayerPersonId !== mePersonId));
  const showAccountField = ledger.tracksBalance && !accountLocked;

  /**
   * 帳戶是必填的。使用者若沒主動選過，就落到第一個帳戶——多數人只有一個「現金」，
   * 等於完全不用碰這個欄位。
   *
   * 刻意用「推導顯示值」而非 useEffect 去 setState：後者會多觸發一輪渲染
   * （cascading render），而 state 只需要保存使用者的明確選擇。
   */
  const selectedAccountId = showAccountField
    ? accountId || (isSharedLedger && sharedPayerChanged ? '' : (accounts.data?.[0]?.id ?? ''))
    : '';
  /** 轉入帳戶不能與轉出帳戶相同（後端回 400 TRANSFER_SAME_ACCOUNT），預設挑第一個不同的。 */
  const otherAccounts = (accounts.data ?? []).filter((account) => account.id !== selectedAccountId);
  const selectedToAccountId = showAccountField
    ? toAccountId && toAccountId !== selectedAccountId
      ? toAccountId
      : (otherAccounts[0]?.id ?? '')
    : '';

  /**
   * 轉帳只在連動帳本才有意義——非連動帳本不影響餘額，後端也會擋
   * （400 `ACCOUNT_NOT_ALLOWED`）。
   *
   * 帳戶鎖住時也不給轉帳（D3）：把別人的支出改成轉帳的話，轉出沿用他的帳戶、
   * 轉入是我的，後端會接受，變成一筆「從他的戶頭轉到我的戶頭」的交易。
   * 反方向（他的轉帳改成支出）允許，錢還留在他的帳戶；改完之後這顆鈕就消失、
   * 回不去——這個情況罕見，而且不可逆的方向是安全的那一邊。
   */
  const canTransfer = ledger.tracksBalance && !accountLocked;
  const showTransferButton = (canTransfer && split === undefined) || type === 'TRANSFER';
  /** 轉帳至少要有兩個帳戶。與其讓使用者送出後撞 400，不如先說清楚。 */
  const transferBlocked = type === 'TRANSFER' && showAccountField && otherAccounts.length === 0;

  /**
   * 分段控制的選項清單。轉帳不一定畫得出來（見 `showTransferButton`）、借還只在
   * 新增模式存在，所以清單是動態的——滑動方塊的寬度與位移都依這份清單算，
   * 少一格時位置才不會算歪。
   */
  const typeOptions: { value: EntryTab; label: string }[] = [
    { value: 'EXPENSE', label: '支出' },
    { value: 'INCOME', label: '收入' },
    ...(showTransferButton ? [{ value: 'TRANSFER' as const, label: '轉帳' }] : []),
    ...(!isEdit ? [{ value: 'DEBT' as const, label: '借還' }] : []),
  ];
  // 找不到（理論上不會）就當第一格，方塊至少停在一個合理的位置。
  const selectedTypeIndex = Math.max(
    typeOptions.findIndex((option) => option.value === tab),
    0,
  );

  /**
   * 切換分頁時一併清掉已選分類——換了型別就是換一組分類，先前選的多半已不在清單中。
   *
   * 刻意在事件處理裡一次改完，而非用 useEffect 事後補救：後者會多觸發一輪
   * 渲染（cascading render），React 也不建議這樣用。
   */
  function handleTypeChange(nextType: EntryTab) {
    setTab(nextType);
    setCategoryId('');
    if (nextType === 'TRANSFER') {
      setSplitEnabled(false);
      if (isSharedLedger) {
        setPaymentMode(ledger.tracksBalance ? 'account' : 'self');
        setSharedPayerPersonId(mePersonId);
        setSharedPayerChanged(false);
        setPayerName('');
      }
    }
  }

  const exactSharedPayer = ledgerPeople.find(
    (person) => person.id !== mePersonId && person.name === payerName.trim(),
  );
  const selectedSharedPayer = ledgerPeople.find((person) => person.id === sharedPayerPersonId);
  const sharedPayerIsOther =
    isSharedLedger &&
    paymentMode === 'counterparty' &&
    (sharedPayerPersonId !== null ? sharedPayerPersonId !== mePersonId : payerName.trim() !== '');
  const isPayerOther = isSharedLedger
    ? sharedPayerIsOther
    : selectedPayer !== null || (payerName.trim() !== '' && payerName.trim() !== '我');
  const payerDisplayName = isSharedLedger
    ? (selectedSharedPayer?.name ?? payerName.trim())
    : (selectedPayer?.name ?? payerName.trim());
  const paymentRowMode =
    isSharedLedger &&
    paymentMode === 'counterparty' &&
    sharedPayerPersonId !== null &&
    sharedPayerPersonId === mePersonId
      ? ledger.tracksBalance
        ? 'account'
        : 'self'
      : paymentMode;
  const previewPayerId =
    selectedPayer?.counterpartyId ??
    (isPayerOther && !isSharedLedger ? `new:${selectedPayer?.name ?? payerName.trim()}` : null);
  const sharedPayerKey = isPayerOther
    ? (sharedPayerPersonId ?? exactSharedPayer?.id ?? `new:${payerDisplayName.trim()}`)
    : mePersonId;
  const sharedPayerPersonIdForSection = isPayerOther
    ? (sharedPayerPersonId ?? exactSharedPayer?.id ?? null)
    : mePersonId;
  const splitPeople =
    splitEnabled && !isPayerOther
      ? participants.filter((person) => person.included)
      : [makeMeParticipant()];
  const previewMethod: SplitMethod = isPayerOther ? 'EQUAL' : splitMethod;
  const previewPrecision: SplitPrecision = isPayerOther ? 'CENT' : splitPrecision;
  const filledCustomValues =
    previewMethod === 'EQUAL'
      ? null
      : fillRemainingShares({
          total: amountCents ?? 0,
          method: previewMethod,
          precision: previewPrecision,
          payerCounterpartyId: previewPayerId,
          participants: splitPeople.map((person) => ({
            counterpartyId: splitPreviewCounterpartyId(person),
            value:
              splitMethod === 'AMOUNT'
                ? person.amountFixed
                  ? person.amountValue
                  : undefined
                : person.ratioFixed
                  ? person.ratioValue
                  : undefined,
          })),
        });
  const splitPreviewInput: SplitParticipantInput[] = splitPeople.map((person, index) => ({
    counterpartyId: splitPreviewCounterpartyId(person),
    ...(previewMethod === 'AMOUNT' && filledCustomValues
      ? { amount: filledCustomValues.values[index]! }
      : {}),
    ...(previewMethod === 'RATIO' && filledCustomValues
      ? { ratio: filledCustomValues.values[index]! }
      : {}),
  }));
  const splitPreview =
    type !== 'TRANSFER' && amountCents !== null && amountCents > 0
      ? computeSplitShares({
          total: amountCents,
          method: previewMethod,
          precision: previewPrecision,
          payerCounterpartyId: previewPayerId,
          participants: splitPreviewInput,
        })
      : null;
  const previewShares =
    splitEnabled && !isPayerOther && splitPreview?.ok
      ? new Map(splitPeople.map((person, index) => [person.key, splitPreview.shares[index]!]))
      : null;
  const myShareIndex = splitPeople.findIndex((person) => person.isMe);
  const myShare = isPayerOther
    ? splitPreview?.ok
      ? splitPreview.shares[myShareIndex]!
      : undefined
    : splitEnabled
      ? splitPreview?.ok && myShareIndex >= 0
        ? splitPreview.shares[myShareIndex]!
        : undefined
      : (amountCents ?? undefined);
  const paymentPreview =
    isPayerOther && myShare !== undefined
      ? {
          from: type === 'EXPENSE' ? '我' : payerDisplayName,
          to: type === 'EXPENSE' ? payerDisplayName : '我',
          amount: myShare,
          srText:
            type === 'EXPENSE'
              ? `你欠${payerDisplayName} ${formatMoney(myShare)}`
              : `${payerDisplayName}欠你 ${formatMoney(myShare)}`,
        }
      : null;
  const activeLedgerSplitPeople = ledgerSplitParticipants.filter((person) => person.included);
  const ledgerFilledCustomValues =
    splitMethod === 'EQUAL'
      ? null
      : fillRemainingSharesByKey({
          total: amountCents ?? 0,
          method: splitMethod,
          precision: splitPrecision,
          payerKey: sharedPayerKey,
          participants: activeLedgerSplitPeople.map((person) => ({
            key: person.key,
            value:
              splitMethod === 'AMOUNT'
                ? person.amountFixed
                  ? person.amountValue
                  : undefined
                : person.ratioFixed
                  ? person.ratioValue
                  : undefined,
          })),
        });
  const ledgerSplitPreview =
    type !== 'TRANSFER' && amountCents !== null && amountCents > 0
      ? computeSharesByKey({
          total: amountCents,
          method: splitMethod,
          precision: splitPrecision,
          payerKey: sharedPayerKey,
          participants: activeLedgerSplitPeople.map((person, index) => ({
            key: person.key,
            ...(splitMethod === 'AMOUNT' && ledgerFilledCustomValues
              ? { amount: ledgerFilledCustomValues.values[index]! }
              : {}),
            ...(splitMethod === 'RATIO' && ledgerFilledCustomValues
              ? { ratio: ledgerFilledCustomValues.values[index]! }
              : {}),
          })),
        })
      : null;
  const ledgerPreviewShares = ledgerSplitPreview?.ok
    ? new Map(
        activeLedgerSplitPeople.map((person, index) => [
          person.key,
          ledgerSplitPreview.shares[index]!,
        ]),
      )
    : null;
  const needsAccount = isSharedLedger
    ? showAccountField &&
      (type === 'TRANSFER' ||
        (!isPayerOther && paymentRowMode !== 'self' && paymentRowMode !== 'counterparty'))
    : showAccountField && (type === 'TRANSFER' || (!isPayerOther && paymentMode !== 'self'));
  const needsSharedPayer =
    isSharedLedger && type !== 'TRANSFER' && paymentRowMode === 'counterparty' && !isPayerOther;

  function clearFixedValues(people: SplitParticipantDraft[]) {
    return people.map((person) => ({
      ...person,
      amountFixed: false,
      amountInput: '',
      amountValue: 0,
      ratioFixed: false,
      ratioInput: '',
      ratioValue: 0,
    }));
  }

  function newParticipant(counterpartyId: string | null, name: string): SplitParticipantDraft {
    return {
      key: counterpartyId ?? `new:${name.trim()}`,
      counterpartyId,
      name,
      isMe: false,
      included: true,
      amountFixed: false,
      amountInput: '',
      amountValue: 0,
      ratioFixed: false,
      ratioInput: '',
      ratioValue: 0,
    };
  }

  function handlePayerSelect(counterparty: Counterparty | null) {
    setSelectedPayer(
      counterparty ? { counterpartyId: counterparty.id, name: counterparty.displayName } : null,
    );
    if (counterparty) {
      setPayerName(counterparty.displayName);
    }
  }

  function handlePayerModeChange(nextMode: 'account' | 'counterparty' | 'self') {
    if (isSharedLedger) {
      const payerWasOther = isPayerOther;
      setPaymentMode(nextMode);
      if (nextMode !== 'counterparty' || !payerWasOther) {
        setSharedPayerPersonId(null);
        setPayerName('');
        setAccountId('');
        setSharedPayerChanged(true);
      }
      return;
    }

    setPaymentMode(nextMode);
    if (nextMode !== 'counterparty') {
      setSelectedPayer(null);
      setPayerName('');
    } else if (!isPayerOther) {
      setPayerName('');
    }
  }

  function handlePayerNameChange(name: string) {
    setPayerName(name);
    if (isSharedLedger) {
      setSharedPayerPersonId(null);
      setAccountId('');
      setSharedPayerChanged(true);
    }
  }

  function handleLedgerPayerSelect(person: LedgerPerson | null) {
    setSharedPayerPersonId(person?.id ?? null);
    if (person) setPayerName(person.name);
    setAccountId('');
    setSharedPayerChanged(true);
  }

  function toggleSplit(enabled: boolean) {
    setSplitEnabled(enabled);
    if (!enabled) {
      setSplitOptionsOpen(false);
      return;
    }
    setParticipants((current) => {
      let next = current.filter((person) => person.included);
      if (next.length === 0) next = [makeMeParticipant()];
      return clearFixedValues(next);
    });
  }

  function toggleLedgerSplit(enabled: boolean) {
    setSplitEnabled(enabled);
    if (!enabled) setSplitOptionsOpen(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountCents === null || amountCents <= 0) {
      return;
    }
    if (type !== 'TRANSFER' && categoryId === '') return;
    if (needsAccount && selectedAccountId === '') return;
    if (
      needsSharedPayer ||
      (isSharedLedger && splitEnabled && activeLedgerSplitPeople.length === 0)
    )
      return;
    if (type === 'TRANSFER' && selectedToAccountId === '') return;

    void submitTransactionOrSplit();
  }

  async function submitTransactionOrSplit(confirmedSyncedEdit = false) {
    if (split && hasSyncedSplitEntries && !confirmedSyncedEdit) {
      setSplitEditWarningOpen(true);
      return;
    }
    setSubmissionError(null);
    setResolvingNames(true);
    const resolvedNames = new Map<string, string>();

    async function resolveName(name: string): Promise<string> {
      const normalized = name.trim();
      const cached = resolvedNames.get(normalized);
      if (cached) return cached;
      const created = await createCounterparty.mutateAsync({ name: normalized });
      resolvedNames.set(normalized, created.id);
      return created.id;
    }

    try {
      const isoDate = new Date(date).toISOString();

      if (isSharedLedger && type !== 'TRANSFER') {
        let createdPayerPerson: LedgerPerson | null = null;
        let payerPersonId: string;
        if (paymentRowMode !== 'counterparty') {
          if (!mePersonId) return;
          payerPersonId = mePersonId;
        } else if (sharedPayerPersonId && sharedPayerPersonId !== mePersonId) {
          payerPersonId = sharedPayerPersonId;
        } else {
          const normalizedName = payerName.trim();
          if (normalizedName === '') return;
          const existing = ledgerPeople.find(
            (person) => person.id !== mePersonId && person.name === normalizedName,
          );
          if (existing) {
            payerPersonId = existing.id;
          } else {
            const created = await createLedgerPerson!.mutateAsync({ name: normalizedName });
            createdPayerPerson = created;
            payerPersonId = created.id;
          }
        }

        const payerIsMe = payerPersonId === mePersonId;
        const ledgerSplitInput = splitEnabled
          ? toLedgerSplitInput(ledgerSplitParticipants, splitMethod, splitPrecision)
          : null;

        if (isEdit && transaction) {
          const input: UpdateTransactionRequest = {
            type,
            amount: amountCents!,
            date: isoDate,
            title,
            note,
            categoryId,
            // PATCH 省略付款人代表維持舊值，切回「我」時也必須明確帶自己的 id。
            payerPersonId,
            ...(payerIsMe && showAccountField ? { accountId: selectedAccountId } : {}),
            ledgerSplit: ledgerSplitInput,
          };
          await updateTransaction.mutateAsync({ transactionId: transaction.id, input });
          onSaved?.();
          return;
        }

        const input: CreateTransactionRequest = {
          type,
          amount: amountCents!,
          date: isoDate,
          categoryId,
          ...(payerIsMe ? {} : { payerPersonId }),
          ...(payerIsMe && showAccountField ? { accountId: selectedAccountId } : {}),
          ...(title === '' ? {} : { title }),
          ...(note === '' ? {} : { note }),
          ...(ledgerSplitInput === null ? {} : { ledgerSplit: ledgerSplitInput }),
        };
        await createTransaction.mutateAsync(input);

        const nextPeople = createdPayerPerson
          ? [...ledgerPeople, createdPayerPerson]
          : ledgerPeople;
        setLedgerSplitParticipants(createDefaultLedgerSplitPeople(nextPeople, mePersonId));
        setLedgerSplitReady(true);
        setSplitEnabled(true);
        setSplitMethod('EQUAL');
        setSplitPrecision('CENT');
        setSharedPayerPersonId(mePersonId);
        setSharedPayerChanged(false);
        setPaymentMode(ledger.tracksBalance ? 'account' : 'self');
        setAccountId('');
        setPayerName('');
        setAmount('');
        setTitle('');
        setNote('');
        return;
      }

      const requiresSplit = split !== undefined || splitEnabled || isPayerOther;

      if (requiresSplit) {
        const splitType: SplitType = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
        // 別人付時金額就是我的份額；舊多人名單保留在表單 state，但不影響這次送出。
        const requestMethod: SplitMethod = isPayerOther ? 'EQUAL' : splitMethod;
        const requestPrecision: SplitPrecision = isPayerOther ? 'CENT' : splitPrecision;
        const splitPeople = isPayerOther
          ? [makeMeParticipant()]
          : splitEnabled
            ? participants.filter((person) => person.included)
            : [makeMeParticipant()];
        const filled =
          requestMethod === 'EQUAL'
            ? null
            : fillRemainingShares({
                total: amountCents!,
                method: requestMethod,
                precision: requestPrecision,
                payerCounterpartyId: previewPayerId,
                participants: splitPeople.map((person) => ({
                  counterpartyId: splitPreviewCounterpartyId(person),
                  value:
                    splitMethod === 'AMOUNT'
                      ? person.amountFixed
                        ? person.amountValue
                        : undefined
                      : person.ratioFixed
                        ? person.ratioValue
                        : undefined,
                })),
              });
        const requestParticipants: SplitParticipantInput[] = [];
        for (let index = 0; index < splitPeople.length; index += 1) {
          const person = splitPeople[index]!;
          const counterpartyId = person.isMe
            ? null
            : (person.counterpartyId ?? (await resolveName(person.name)));
          requestParticipants.push({
            counterpartyId,
            ...(requestMethod === 'AMOUNT' && filled ? { amount: filled.values[index]! } : {}),
            ...(requestMethod === 'RATIO' && filled ? { ratio: filled.values[index]! } : {}),
          });
        }
        const payerId = isPayerOther
          ? (selectedPayer?.counterpartyId ?? (await resolveName(payerDisplayName)))
          : null;
        const input: UpdateSplitRequest = {
          type: splitType,
          ledgerId,
          categoryId,
          total: amountCents!,
          date: isoDate,
          title,
          note,
          payer: payerId === null ? null : { counterpartyId: payerId },
          ...(payerId === null && showAccountField ? { accountId: selectedAccountId } : {}),
          method: requestMethod,
          ...(requestMethod === 'AMOUNT' ? {} : { precision: requestPrecision }),
          participants: requestParticipants,
        };

        if (split) {
          await updateSplit.mutateAsync({ splitId: split.id, input });
          onSaved?.();
        } else {
          const createInput: CreateSplitRequest = {
            ...input,
            ...(title === '' ? { title: undefined } : {}),
            ...(note === '' ? { note: undefined } : {}),
            ...(transaction ? { fromTransactionId: transaction.id } : {}),
          };
          await createSplit.mutateAsync(createInput);
          if (isEdit) onSaved?.();
          else {
            setAmount('');
            setTitle('');
            setNote('');
            // 下一筆回到預設的「我付、不分」（W66）：分帳的人與付款人每筆都不同，留著反而容易記錯。
            setSplitEnabled(false);
            setSplitMethod('EQUAL');
            setSplitPrecision('CENT');
            setParticipants([makeMeParticipant()]);
            setPaymentMode(ledger.tracksBalance ? 'account' : 'self');
            setSelectedPayer(null);
            setPayerName('');
          }
        }
        return;
      }

      if (isEdit && transaction) {
        const input: UpdateTransactionRequest = {
          type,
          amount: amountCents!,
          date: isoDate,
          title,
          note,
          ...(type === 'TRANSFER' ? {} : { categoryId }),
          ...(showAccountField ? { accountId: selectedAccountId } : {}),
          ...(showAccountField && type === 'TRANSFER' ? { toAccountId: selectedToAccountId } : {}),
        };
        await updateTransaction.mutateAsync({ transactionId: transaction.id, input });
        onSaved?.();
        return;
      }

      await createTransaction.mutateAsync({
        type,
        amount: amountCents!,
        date: isoDate,
        categoryId: type === 'TRANSFER' ? undefined : categoryId,
        accountId: selectedAccountId === '' ? undefined : selectedAccountId,
        toAccountId:
          type === 'TRANSFER' && selectedToAccountId !== '' ? selectedToAccountId : undefined,
        title: title === '' ? undefined : title,
        note: note === '' ? undefined : note,
      });
      setAmount('');
      setTitle('');
      setNote('');
    } catch (error) {
      setSubmissionError(error);
    } finally {
      setResolvingNames(false);
    }
  }

  /**
   * 帳戶可以被刪光（後端只擋「有交易引用」的），但連動帳本的交易必須指定帳戶。
   * 那時若照常渲染表單，使用者面對的是一個空的下拉，按下送出必定得到 400，
   * 而畫面上沒有任何線索說明原因——解法還在另一個頁面。所以直接換成引導。
   *
   * 編輯別人的交易時不受影響：那時根本不需要自己的帳戶。
   */
  if (
    showAccountField &&
    !isPayerOther &&
    !(isSharedLedger && paymentRowMode === 'counterparty') &&
    !accounts.isLoading &&
    (accounts.data?.length ?? 0) === 0
  ) {
    return (
      <section>
        <p className={styles.legend}>新增一筆交易</p>
        <p className={styles.blocked}>
          記帳前要先有一個帳戶。<Link to="/accounts">前往新增帳戶</Link>
        </p>
      </section>
    );
  }

  /* 分段控制兩種模式都畫，差別只在選項清單（編輯模式沒有「借還」那格）。 */
  const segmented = (
    <div className={styles.types}>
      {/*
        滑動的選中方塊（SC-43.2）。它疊在按鈕上方、不吃點擊，寬度是一格、
        位移是「第幾格 × 100%」——按鈕本身不再各自畫底色，切換時方塊滑過去。
        寬度與位移依**實際畫出來的按鈕數**算，所以沒有轉帳鈕時也對得準。
      */}
      <span className={styles.thumbTrack} aria-hidden="true">
        <span
          className={styles.thumb}
          style={{
            width: `${100 / typeOptions.length}%`,
            transform: `translateX(${selectedTypeIndex * 100}%)`,
          }}
        />
      </span>
      {typeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.type}
          aria-pressed={tab === option.value}
          onClick={() => handleTypeChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  /* 欄位與動作鈕在兩種模式長得一樣，抽出來讓兩個 return 共用。 */
  const transactionFields = (
    <>
      {/* 金額自成一列並放大：它是這張表單唯一非填不可的數字，要一眼看到。 */}
      <div className={styles.amount}>
        <TextField
          label="金額"
          id={amountFieldId}
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={amount}
          required
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      <div className={styles.row}>
        <TextField
          label="日期"
          type="date"
          value={date}
          required
          onChange={(event) => setDate(event.target.value)}
        />
        {/* 轉帳沒有分類（「從銀行領錢」不屬於任何消費類別），欄位整個不渲染。
            那時這一列只剩日期，auto-fit 會讓它自己撐滿。 */}
        {type !== 'TRANSFER' && (
          <CategoryPicker
            categories={categories.data ?? []}
            value={categoryId}
            onChange={setCategoryId}
          />
        )}
      </div>

      {/* 非連動帳本沒有帳戶欄位。停用而非移除是不夠的——後端連「帶著空值」都會
          擋下（400 ACCOUNT_NOT_ALLOWED），而且一個停用的欄位會讓人以為
          「應該要能選，只是現在不行」。 */}
      {type === 'TRANSFER' ? (
        <>
          <Select
            label="轉出帳戶"
            value={selectedAccountId}
            required
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          {transferBlocked ? (
            <p className={styles.notice}>
              轉帳需要兩個帳戶，目前只有一個。<Link to="/accounts">前往新增帳戶</Link>
            </p>
          ) : (
            <Select
              label="轉入帳戶"
              value={selectedToAccountId}
              required
              onChange={(event) => setToAccountId(event.target.value)}
            >
              {otherAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </>
      ) : (
        <PaymentRow
          type={type}
          accounts={accounts.data ?? []}
          accountId={selectedAccountId}
          showAccountField={showAccountField}
          accountLocked={accountLocked}
          mode={paymentRowMode}
          payerName={payerDisplayName}
          isPayerOther={isPayerOther}
          preview={isSharedLedger ? null : paymentPreview}
          ledgerPeople={isSharedLedger ? ledgerPeople : undefined}
          mePersonId={mePersonId}
          selectedLedgerPersonId={sharedPayerPersonId}
          onAccountChange={setAccountId}
          onModeChange={handlePayerModeChange}
          onPayerNameChange={handlePayerNameChange}
          onPayerSelect={handlePayerSelect}
          onLedgerPersonSelect={isSharedLedger ? handleLedgerPayerSelect : undefined}
        />
      )}

      <TextField
        label="名稱"
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />

      <TextField
        label="備註"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />

      {type !== 'TRANSFER' && isSharedLedger && (
        <LedgerSplitSection
          enabled={splitEnabled}
          pending={pending || !ledgerSplitReady}
          type={type}
          participants={ledgerSplitParticipants}
          payerPersonId={sharedPayerPersonIdForSection}
          payerName={isPayerOther ? payerDisplayName : '我'}
          previewShares={ledgerPreviewShares}
          onToggle={toggleLedgerSplit}
          onTogglePerson={(personId, included) =>
            setLedgerSplitParticipants((current) =>
              clearFixedValues(
                current.map((person) =>
                  person.key === personId ? { ...person, included } : person,
                ),
              ),
            )
          }
          onOpenOptions={() => setSplitOptionsOpen(true)}
        />
      )}
      {type !== 'TRANSFER' && !isSharedLedger && !isPayerOther && (
        <SplitSection
          enabled={splitEnabled}
          pending={pending}
          type={type}
          isPayerOther={isPayerOther}
          participants={participants}
          previewShares={previewShares}
          onToggle={toggleSplit}
          onAddCounterparty={(counterparty) => {
            setParticipants((current) => {
              if (current.some((person) => person.counterpartyId === counterparty.id))
                return current;
              return clearFixedValues([
                ...current,
                newParticipant(counterparty.id, counterparty.displayName),
              ]);
            });
          }}
          onAddName={(name) => {
            setParticipants((current) => {
              if (current.some((person) => person.name === name.trim())) return current;
              return clearFixedValues([...current, newParticipant(null, name.trim())]);
            });
          }}
          onRemoveParticipant={(key) =>
            setParticipants((current) =>
              clearFixedValues(current.filter((person) => person.key !== key || person.isMe)),
            )
          }
          onToggleMe={(checked) =>
            setParticipants((current) =>
              clearFixedValues(
                current.map((person) => (person.isMe ? { ...person, included: checked } : person)),
              ),
            )
          }
          onOpenOptions={() => setSplitOptionsOpen(true)}
        />
      )}

      {/* 編輯模式才有「取消」。新增表單常駐在面板裡，沒有東西可以取消。 */}
      <div className={styles.actions}>
        <Button
          type="submit"
          block
          disabled={
            pending ||
            transferBlocked ||
            amountCents === null ||
            amountCents <= 0 ||
            (type !== 'TRANSFER' && categoryId === '') ||
            (isSharedLedger && type !== 'TRANSFER'
              ? splitEnabled && (activeLedgerSplitPeople.length === 0 || !ledgerSplitPreview?.ok)
              : (splitEnabled || isPayerOther) && !splitPreview?.ok) ||
            needsSharedPayer ||
            (isSharedLedger && type !== 'TRANSFER' && mePersonId === null) ||
            (needsAccount && selectedAccountId === '') ||
            (type === 'TRANSFER' && selectedToAccountId === '')
          }
        >
          {pending ? (isEdit ? '儲存中…' : '新增中…') : isEdit ? '儲存' : '新增'}
        </Button>
        {isEdit && onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        )}
        {transaction && !split && (
          <Button
            type="button"
            variant="secondary"
            className={styles.deleteButton}
            onClick={() => {
              deleteTransaction.reset();
              setDeleteTransactionOpen(true);
            }}
          >
            刪除
          </Button>
        )}
        {split && (
          <Button type="button" variant="secondary" onClick={() => setDeleteSplitOpen(true)}>
            刪除分帳
          </Button>
        )}
      </div>
    </>
  );

  const editorPages = (
    <div className={styles.pages}>
      <div
        className={`${styles.mainPage} ${splitOptionsOpen ? styles.mainPageHidden : ''}`}
        aria-hidden={splitOptionsOpen}
        inert={splitOptionsOpen}
      >
        {segmented}
        {transactionFields}
      </div>
      {splitEnabled &&
        splitOptionsOpen &&
        type !== 'TRANSFER' &&
        (isSharedLedger || !isPayerOther) && (
          <SplitOptionsView
            total={amountCents}
            type={type}
            payerCounterpartyId={isSharedLedger ? undefined : previewPayerId}
            payerKey={isSharedLedger ? sharedPayerKey : undefined}
            fallbackKey={isSharedLedger ? undefined : SPLIT_ME_KEY}
            payerName={payerDisplayName}
            method={splitMethod}
            precision={splitPrecision}
            participants={isSharedLedger ? activeLedgerSplitPeople : participants}
            onBack={() => setSplitOptionsOpen(false)}
            onSave={(value) => {
              setSplitMethod(value.method);
              setSplitPrecision(value.precision);
              if (isSharedLedger) {
                const saved = new Map(value.participants.map((person) => [person.key, person]));
                setLedgerSplitParticipants((current) =>
                  clearFixedValues(current).map((person) => {
                    const selected = saved.get(person.key);
                    return selected
                      ? { ...person, ...selected, included: true }
                      : { ...person, included: false };
                  }),
                );
              } else {
                setParticipants(value.participants);
              }
              setSplitOptionsOpen(false);
            }}
          />
        )}
    </div>
  );

  /*
   * 「借還」分頁換成 DebtEntryForm，而它內部有自己的 <form>——HTML 不允許
   * form 巢狀（內層會被瀏覽器當成前一個的結尾，送出邏輯整個錯亂）。所以新增
   * 模式的外層不是 <form>：標題與分段控制共用，底下的內容依分頁換交易 <form>
   * 或 DebtEntryForm。編輯模式沒有「借還」，維持原本的單一 <form>。
   */
  if (isEdit) {
    return (
      <>
        <form onSubmit={handleSubmit} noValidate>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <FormError error={error} />
            {editorPages}
          </fieldset>
        </form>
        {transaction && !split && (
          <ConfirmDialog
            open={deleteTransactionOpen}
            title="刪除交易"
            message="確定要刪除這筆交易嗎？刪除後無法復原。"
            confirmLabel="刪除"
            error={deleteTransaction.error}
            isPending={deleteTransaction.isPending}
            onCancel={() => {
              setDeleteTransactionOpen(false);
              deleteTransaction.reset();
            }}
            onConfirm={() => {
              deleteTransaction.mutate(transaction.id, {
                onSuccess: () => {
                  setDeleteTransactionOpen(false);
                  onSaved?.();
                },
              });
            }}
          />
        )}
        {split && (
          <ConfirmDialog
            open={deleteSplitOpen}
            title="刪除分帳"
            message={hasSyncedSplitEntries ? '刪除後會送給對方確認。' : '刪除分帳？'}
            confirmLabel="刪除"
            error={deleteSplit.error}
            isPending={deleteSplit.isPending}
            onCancel={() => setDeleteSplitOpen(false)}
            onConfirm={() => {
              void deleteSplit
                .mutateAsync(split.id)
                .then(() => onSaved?.())
                .catch(setSubmissionError);
            }}
          />
        )}
        {split && (
          <ConfirmDialog
            open={splitEditWarningOpen}
            title="修改分帳"
            message="修改後會送給對方確認。"
            confirmLabel="繼續修改"
            isPending={pending}
            onCancel={() => setSplitEditWarningOpen(false)}
            onConfirm={() => {
              setSplitEditWarningOpen(false);
              void submitTransactionOrSplit(true);
            }}
          />
        )}
      </>
    );
  }

  return (
    // 外框由放它的地方給（右側面板，或窄螢幕的卡片），表單自己不畫框。
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend className={styles.legend}>新增一筆交易</legend>
      {isDebtTab ? (
        <>
          {segmented}
          <DebtEntryForm
            ledger={ledger}
            amountFieldId={amountFieldId}
            initialCounterpartyName={initialDebtCounterparty}
          />
        </>
      ) : (
        <>
          <FormError error={error} />
          <form onSubmit={handleSubmit} noValidate>
            {editorPages}
          </form>
        </>
      )}
    </fieldset>
  );
}

/**
 * 名單一定有「我」這一列（修訂 2，W92）：只幫別人付的分帳，名單裡沒有我，打開編輯時補一列
 * 沒勾選的「我」，讓使用者能再勾回來。
 */
function withMeRow(people: SplitParticipantDraft[]): SplitParticipantDraft[] {
  if (people.some((person) => person.isMe)) return people;
  return [{ ...makeMeParticipant(), included: false }, ...people];
}

function makeMeParticipant(): SplitParticipantDraft {
  return makeSplitParticipant(SPLIT_ME_KEY, null, '我', true);
}

function makeSplitParticipant(
  key: string,
  counterpartyId: string | null,
  name: string,
  isMe: boolean,
): SplitParticipantDraft {
  return {
    key,
    counterpartyId,
    name,
    isMe,
    included: true,
    amountFixed: false,
    amountInput: '',
    amountValue: 0,
    ratioFixed: false,
    ratioInput: '',
    ratioValue: 0,
  };
}
