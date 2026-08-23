import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LedgerDetail } from '@ledger/shared';
import { Button } from '../components/Button';
import { useCurrentUser } from '../features/auth/use-current-user';
import { LedgerRenameDialog } from '../features/ledgers/LedgerRenameDialog';
import { useLedger } from '../features/ledgers/use-ledgers';
import { ApiError } from '../lib/api-client';
import { formatDate } from '../lib/format';
import styles from './LedgerDetailPage.module.css';

/**
 * 帳本明細：基本資訊、成員清單、以及 owner 才有的管理操作。
 *
 * **無權存取的帳本，後端回 404 而不是 403**，這裡也一律顯示「找不到」。回 403 或說
 * 「你沒有權限看這本帳本」等於承認它存在——光是這件事就已經是洩漏。
 */
export default function LedgerDetailPage() {
  const { ledgerId } = useParams<{ ledgerId: string }>();
  const ledger = useLedger(ledgerId ?? null);
  const [renaming, setRenaming] = useState<LedgerDetail | null>(null);

  if (ledger.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }

  // 404 與其他錯誤都收斂成同一句話。分開講就等於把「這本帳本存在」透露出去。
  if (ledger.error || !ledger.data) {
    const notFound = ledger.error instanceof ApiError && ledger.error.statusCode === 404;
    return (
      <section>
        <h2 className={styles.title}>帳本</h2>
        <p className={styles.status}>
          {notFound ? '找不到這本帳本。' : '無法載入這本帳本，請稍後再試。'}
        </p>
        <Link to="/ledgers">回到帳本列表</Link>
      </section>
    );
  }

  return <LedgerDetailView ledger={ledger.data} onRename={setRenaming} renaming={renaming} />;
}

function LedgerDetailView({
  ledger,
  renaming,
  onRename,
}: {
  ledger: LedgerDetail;
  renaming: LedgerDetail | null;
  onRename: (ledger: LedgerDetail | null) => void;
}) {
  const currentUser = useCurrentUser();
  const myRole = ledger.members.find((member) => member.userId === currentUser.data?.id)?.role;
  // 隱藏做不到的按鈕是體驗，不是授權。真正的防線是後端的 @RequireLedgerRole；
  // 這裡從不用角色決定「資料能不能拿」，只決定「按鈕畫不畫」。
  const isOwner = myRole === 'OWNER';

  return (
    <section>
      <header className={styles.header}>
        <h2 className={styles.title}>{ledger.name}</h2>
        {isOwner && ledger.archivedAt === null && (
          <Button variant="secondary" onClick={() => onRename(ledger)}>
            改名
          </Button>
        )}
      </header>

      <dl className={styles.facts}>
        <Fact
          label="帳本類型"
          value={ledger.kind === 'SHARED' ? '共享' : '私人'}
          note="建立後不可更改"
        />
        <Fact
          label="與我的帳戶餘額"
          value={ledger.tracksBalance ? '連動' : '不連動'}
          note="建立後不可更改"
        />
        <Fact label="幣別" value={ledger.currency} />
        <Fact label="我的角色" value={myRole ? ROLE_LABEL[myRole] : '—'} />
        {ledger.archivedAt !== null && (
          <Fact label="已封存" value={formatDate(ledger.archivedAt)} note="封存後僅可讀取" />
        )}
      </dl>

      <h3 className={styles.subtitle}>成員（{ledger.members.length}）</h3>
      <ul className={styles.members}>
        {ledger.members.map((member) => (
          <li className={styles.member} key={member.userId}>
            <div className={styles.who}>
              <span className={styles.name}>{member.name}</span>
              <span className={styles.email}>{member.email}</span>
            </div>
            <span className={styles.role}>{ROLE_LABEL[member.role]}</span>
          </li>
        ))}
      </ul>

      {/* 成員的加入 / 改角色 / 移除是 Step 6。這裡先只呈現。 */}

      <LedgerRenameDialog ledger={renaming} onClose={() => onRename(null)} />
    </section>
  );
}

const ROLE_LABEL: Record<'OWNER' | 'EDITOR' | 'VIEWER', string> = {
  OWNER: '擁有者',
  EDITOR: '可編輯',
  VIEWER: '唯讀',
};

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>
        {value}
        {note && <span className={styles.factNote}>{note}</span>}
      </dd>
    </div>
  );
}
