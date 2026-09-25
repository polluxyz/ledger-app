import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { PageContent } from '../components/PageContent';
import { CounterpartyPicker } from '../features/debts/CounterpartyPicker';
import { AuthDialog, type AuthDialogMode } from '../features/auth/AuthDialog';
import { useAuth } from '../features/auth/use-auth';
import { useAcceptInviteLink, useInvitePreview } from '../features/linking/use-linking';
import { useOpenCounterpartyLedger } from '../features/linking/navigation';
import { ApiError } from '../lib/api-client';
import styles from './InvitePage.module.css';

/**
 * 邀請 token 只在這個頁面的記憶體裡保留；預覽與接受都交給 linking hooks，
 * 讓 token 只隨請求本文送出，避免又被加進網址或其他可留存的位置。
 */
export default function InvitePage() {
  const [token] = useState(readInviteToken);
  const [authDialog, setAuthDialog] = useState<AuthDialogMode | null>(null);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const openCounterpartyLedger = useOpenCounterpartyLedger();
  const preview = useInvitePreview(isAuthenticated ? token : null);
  const acceptInvite = useAcceptInviteLink();

  function finishAccept(counterparty?: { id: string } | { name: string }) {
    if (token === null) {
      return;
    }

    const onSuccess = (accepted: { counterpartyId: string | null }) => {
      // 成功後先清掉網址上的邀請憑證，再導覽，避免目的頁或複製網址時仍帶著它。
      window.history.replaceState(null, '', '/invite');
      if (accepted.counterpartyId) {
        openCounterpartyLedger(accepted.counterpartyId);
      } else {
        void navigate('/transactions?view=debts');
      }
    };

    if (counterparty === undefined) {
      acceptInvite.mutate({ token }, { onSuccess });
    } else {
      acceptInvite.mutate({ token, counterparty }, { onSuccess });
    }
  }

  let content: ReactNode;
  if (token === null) {
    content = (
      <>
        <h1 className={styles.heading}>連結無法使用</h1>
        <p className={styles.description}>這個邀請連結不完整，請對方重新傳一次。</p>
        <ReturnLink />
      </>
    );
  } else if (!isAuthenticated) {
    // 未登入時先不預覽；登入狀態變更後同一個 token 會啟動預覽，網址 hash 不必改動。
    content = (
      <>
        <h1 className={styles.heading}>你收到一個連動邀請</h1>
        <p className={styles.description}>登入後查看邀請。</p>
        <div className={styles.actions}>
          <Button onClick={() => setAuthDialog('login')}>登入</Button>
          <Button variant="secondary" onClick={() => setAuthDialog('register')}>
            註冊
          </Button>
        </div>
      </>
    );
  } else if (preview.isLoading) {
    content = <p className={styles.status}>載入中…</p>;
  } else if (preview.isError) {
    // 格式不對的 token（被截斷、手動改過）後端回 400；對使用者來說和過期一樣，補救方法也一樣，
    // 所以同樣顯示「無效或已過期」，不把驗證訊息原文秀出來。
    if (
      preview.error instanceof ApiError &&
      (preview.error.errorCode === 'INVITE_LINK_INVALID' ||
        preview.error.errorCode === 'VALIDATION_FAILED')
    ) {
      content = (
        <>
          <h1 className={styles.heading}>連結無法使用</h1>
          <p className={styles.description}>這個連結無效或已過期，請對方重新產生。</p>
          <ReturnLink />
        </>
      );
    } else {
      content = (
        <>
          <FormError error={preview.error} />
          <ReturnLink />
        </>
      );
    }
  } else if (preview.data) {
    content = (
      <InvitePreviewCard
        inviterName={preview.data.inviterName}
        forLink={preview.data.forLink}
        expiresAt={preview.data.expiresAt}
        acceptError={acceptInvite.error}
        isAccepting={acceptInvite.isPending}
        onAccept={finishAccept}
        onDecline={() => void navigate('/')}
      />
    );
  } else {
    content = <p className={styles.status}>載入中…</p>;
  }

  return (
    <PageContent>
      <div className={styles.center}>
        <section className={styles.card}>{content}</section>
        {token !== null && (
          <AuthDialog
            mode={isAuthenticated ? null : authDialog}
            onClose={() => setAuthDialog(null)}
          />
        )}
      </div>
    </PageContent>
  );
}

/**
 * 預覽成功才建立這個表單，讓預填名稱成為預設的新對象；只有明確選到清單中的人，
 * 才會改送對方 id。這樣「名字剛好一樣」不會被誤認成使用者已選好既有對象。
 */
function InvitePreviewCard({
  inviterName,
  forLink,
  expiresAt,
  acceptError,
  isAccepting,
  onAccept,
  onDecline,
}: {
  inviterName: string;
  forLink: boolean;
  expiresAt: string;
  acceptError: unknown;
  isAccepting: boolean;
  onAccept: (counterparty?: { id: string } | { name: string }) => void;
  onDecline: () => void;
}) {
  const [counterpartyName, setCounterpartyName] = useState(inviterName);
  const [counterpartyId, setCounterpartyId] = useState<string | null>(null);

  function accept() {
    if (!forLink) {
      onAccept();
    } else if (counterpartyId) {
      onAccept({ id: counterpartyId });
    } else {
      onAccept({ name: counterpartyName.trim() });
    }
  }

  return (
    <>
      <h1 className={styles.heading}>
        {forLink ? `${inviterName} 邀請你連動往來帳` : `${inviterName} 邀請你`}
      </h1>
      {forLink && (
        <>
          <p className={styles.description}>
            接受後，你們之後記的借還會互相同步。之前的紀錄不會同步。連結有效到{' '}
            {formatLocalTime(expiresAt)}。
          </p>
          <CounterpartyPicker
            excludeLinked
            label="對方在你的往來帳裡是誰？"
            value={counterpartyName}
            onChange={setCounterpartyName}
            onSelect={(counterparty) => setCounterpartyId(counterparty?.id ?? null)}
            hint="已經用別的名字記過對方？改選那個人。"
          />
        </>
      )}
      <FormError error={acceptError} />
      <div className={styles.actions}>
        <Button variant="secondary" disabled={isAccepting} onClick={onDecline}>
          拒絕
        </Button>
        <Button
          disabled={isAccepting || (forLink && counterpartyName.trim() === '')}
          onClick={accept}
        >
          {isAccepting ? '處理中…' : forLink ? '接受並連動' : '接受'}
        </Button>
      </div>
    </>
  );
}

function ReturnLink() {
  return (
    <Link className={styles.returnLink} to="/">
      回到總覽
    </Link>
  );
}

/** 本地顯示到期時間，固定 24 小時制，避免邀請人與收件人對 AM／PM 有不同理解。 */
function formatLocalTime(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(expiresAt));
}

/** hash 只在元件初次掛載時解碼並放入 state；格式不完整時按無 token 狀態處理。 */
function readInviteToken(): string | null {
  const encodedToken = window.location.hash.slice(1);
  if (encodedToken === '') {
    return null;
  }

  try {
    const token = decodeURIComponent(encodedToken);
    return token === '' ? null : token;
  } catch {
    return null;
  }
}
