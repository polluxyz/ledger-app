import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Category, CategoryType, LedgerSummary } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { SlideDown } from '../components/SlideDown';
import { CategoryDialog } from '../features/categories/CategoryDialog';
import { CategoryList } from '../features/categories/CategoryList';
import { useCategories, useDeleteCategory } from '../features/categories/use-categories';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import styles from './CategoriesPage.module.css';

/**
 * 分類管理頁：支出／收入兩組清單，以及新增、改名、刪除。
 *
 * ## 這一頁的帳本是獨立選的（D7–D11）
 *
 * 開發者明確決定：這一頁有自己的帳本選擇器，與側邊欄的「作用中帳本」各自獨立
 * ——側邊欄決定**記帳寫進哪一本**，這裡決定**現在在管哪一本的分類**，兩者可以
 * 不同。選擇放在網址查詢字串（`?ledgerId=`）而不是 state：重整要保留、要能加
 * 書籤、別的頁面要能直接連過來指定某一本。
 *
 * 也因為兩者可以不同，畫面必須讓使用者看得出來——選到的帳本與作用中帳本不一致
 * 時顯示提示條（D8），那是這個決定的必要配套，不是裝飾。
 *
 * ## 彈窗的資料流留在這一層
 *
 * 與 `AccountsPage` 同一套：`CategoryDialog` 與 `ConfirmDialog` 只負責呈現與回報，
 * mutation、載入中與錯誤都在頁面手裡，那兩個元件才通用得起來。
 */
export default function CategoriesPage() {
  const { ledger: activeLedger, ledgers, isLoading, error, setActiveLedgerId } = useActiveLedger();
  const [searchParams, setSearchParams] = useSearchParams();

  // 網址上的 ledgerId 只是候選值，要與清單對照過才採用（D11）。它隨時可能失效：
  // 帳本被刪、我被移出成員、帳本被封存（清單不含已封存的，自然對不上）、或手打
  // 亂填。對不上就退回作用中帳本，並在畫面上說一聲——不導頁、不清空畫面。
  const requestedId = searchParams.get('ledgerId');
  const requested =
    requestedId === null ? undefined : ledgers.find((item) => item.id === requestedId);
  // 清單還沒回來時不做任何判斷——那時「對不上」只是因為還沒載入。
  const notFound =
    !isLoading && ledgers.length > 0 && requestedId !== null && requested === undefined;
  const ledger = requested ?? activeLedger;

  // 角色直接從清單元素拿（LedgerSummary 自帶 role），不另外發請求（D9）。
  // 這只決定按鈕畫不畫，是體驗不是授權——真正的防線是後端的 @RequireLedgerRole，
  // 前端絕不拿角色決定要不要發請求或過濾資料。
  const canEdit = ledger?.role === 'OWNER' || ledger?.role === 'EDITOR';

  // 帳本還沒定案的三種狀態。清單來自 ActiveLedgerProvider 的快取，不另外發請求。
  if (isLoading) {
    return (
      <section className={styles.page}>
        <p className={styles.status}>載入中…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className={styles.page}>
        <FormError error={error} />
      </section>
    );
  }
  if (!ledger || !activeLedger) {
    return (
      <section className={styles.page}>
        <p className={styles.status}>找不到任何帳本。</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {/* 說明文字講清楚「現在管的是哪一本」。只有一本帳本時不畫下拉，
          這行就是帳本名的唯一顯示處（比照 LedgerSwitcher 的做法）。 */}
      <PageHeader title="分類" description={`目前管理「${ledger.name}」的分類`} />

      {notFound && (
        <p className={styles.notice}>找不到指定的帳本，已改為顯示『{ledger.name}』的分類。</p>
      )}

      {/* 不一致提示條（D8）。多數時候兩邊一致、什麼都不顯示——這條只該在
          「刻意切去管別本」的時候出現，常駐只會變成雜訊。 */}
      {ledger.id !== activeLedger.id && (
        <div className={styles.banner}>
          <p className={styles.bannerText}>
            你正在管理「{ledger.name}」的分類。記帳目前使用的是「{activeLedger.name}」。
          </p>
          {/* 整頁唯一能把作用中帳本切過去的地方——提示條講的就是這件事，
              按鈕也只該出現在這裡。 */}
          <Button variant="secondary" onClick={() => setActiveLedgerId(ledger.id)}>
            改用{ledger.name}記帳
          </Button>
        </div>
      )}

      {/* 帳本選擇器。清單在快取裡，不另外發請求；選擇寫進網址（D7、D9）。 */}
      {ledgers.length > 1 && (
        // 只有幾個選項的下拉不需要拉滿整頁寬（提案 v2 診斷：原本拉滿 832px）。
        <div className={styles.ledgerPicker}>
          <Select
            label="管理哪一本帳本的分類"
            value={ledger.id}
            onChange={(event) => setSearchParams({ ledgerId: event.target.value })}
          >
            {ledgers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!canEdit && <p className={styles.readonly}>你在這本帳本是檢視者，無法變更分類。</p>}

      {/*
        換一本帳本就換一組清單與彈窗狀態。用 key 讓 React 整棵重建，比逐一歸零
        state 可靠——漏掉一個的症狀是「刪除確認彈窗裡還停著上一本的分類名」。
        比照首頁 LedgerTransactions 的做法。
      */}
      <LedgerCategories key={ledger.id} ledger={ledger} canEdit={canEdit} />
    </section>
  );
}

/**
 * 單一帳本的分類區：支出與收入兩個區塊，加上新增／改名／刪除的表單。
 * 與外層分開，是為了讓 `key={ledger.id}` 能連彈窗狀態一起重置（見上方說明）。
 *
 * **`editing` 只存一個目標**，所以「同一時間只展開一個新增表單」（SC-30.5）
 * 是這個資料結構自然的結果，不必另外記一份開關。
 */
function LedgerCategories({ ledger, canEdit }: { ledger: LedgerSummary; canEdit: boolean }) {
  const deleteCategory = useDeleteCategory(ledger.id);

  // null = 關閉；{ type } = 新增那個型別；分類物件 = 改名那一筆。
  const [editing, setEditing] = useState<Category | { type: CategoryType } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);

  // 新增（往下展開）與改名（小視窗）兩種目標拆開看，下面兩處各自只關心一種。
  const creating = editing !== null && !('id' in editing) ? editing.type : null;
  const renaming = editing !== null && 'id' in editing ? editing : null;

  function closeRemove() {
    setRemoving(null);
    // 清掉上一次的失敗，下次開啟才不會殘留紅字。
    deleteCategory.reset();
  }

  function confirmRemove() {
    if (removing) {
      // 失敗時**不關彈窗**——409（仍有交易引用）是按下確認之後才發生的，
      // 關掉的話使用者只會看到「什麼都沒發生」。錯誤由 ConfirmDialog 就地顯示。
      deleteCategory.mutate(removing.id, { onSuccess: closeRemove });
    }
  }

  return (
    <>
      <div className={styles.groups}>
        {(['EXPENSE', 'INCOME'] as const).map((type) => (
          <CategoryGroup
            key={type}
            ledgerId={ledger.id}
            type={type}
            canEdit={canEdit}
            creating={creating === type}
            // 按第二次收起。換成另一個型別時，上一個自然收起（同一份 state）。
            onToggleCreate={() => setEditing(creating === type ? null : { type })}
            onCloseCreate={() => setEditing(null)}
            onEdit={setEditing}
            onRemove={setRemoving}
          />
        ))}
      </div>

      {/* 改名維持小視窗（§4.7）。新增那一份在各自區塊的 SlideDown 裡。 */}
      <CategoryDialog ledgerId={ledger.id} target={renaming} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={removing !== null}
        title="刪除分類"
        message={`確定要刪除「${removing?.name ?? ''}」嗎？此操作無法復原。`}
        confirmLabel="刪除"
        error={deleteCategory.error}
        isPending={deleteCategory.isPending}
        onConfirm={confirmRemove}
        onCancel={closeRemove}
      />
    </>
  );
}

interface CategoryGroupProps {
  ledgerId: string;
  type: CategoryType;
  canEdit: boolean;
  /** 這一組的新增表單是不是展開著。 */
  creating: boolean;
  onToggleCreate: () => void;
  onCloseCreate: () => void;
  onEdit: (category: Category) => void;
  onRemove: (category: Category) => void;
}

/**
 * 一個型別的區塊：標題列（計數與新增鈕）、往下展開的新增表單、清單。
 *
 * 支出與收入只差型別，所以做成一個元件渲染兩次——複製兩份的話，下次改標題列
 * 就會有一邊忘記改。清單的請求放在這一層，計數才拿得到自己那一組的長度。
 */
function CategoryGroup({
  ledgerId,
  type,
  canEdit,
  creating,
  onToggleCreate,
  onCloseCreate,
  onEdit,
  onRemove,
}: CategoryGroupProps) {
  const categories = useCategories(ledgerId, type);
  // 標題與按鈕的文字是 e2e 的選取器，一字都不能改。
  const label = type === 'EXPENSE' ? '支出' : '收入';
  const createLabel = type === 'EXPENSE' ? '新增支出分類' : '新增收入分類';

  return (
    <section className={styles.group}>
      <header className={styles.groupHeader}>
        <h3 className={styles.groupTitle}>
          {label}（{categories.data?.length ?? 0}）
        </h3>
        {canEdit && (
          <Button aria-expanded={creating} onClick={onToggleCreate}>
            <Icon name="plus" />
            {createLabel}
          </Button>
        )}
      </header>

      <SlideDown open={creating}>
        {/* 面板本身沒有外框（Dialog 的 panel 變體刻意不畫），這張卡片就是它的外框。 */}
        <div className={styles.panel}>
          <CategoryDialog
            ledgerId={ledgerId}
            target={{ type }}
            variant="panel"
            onClose={onCloseCreate}
          />
        </div>
      </SlideDown>

      <CategoryList
        categories={categories.data ?? []}
        isLoading={categories.isLoading}
        error={categories.error}
        canEdit={canEdit}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </section>
  );
}
