import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { PageContent } from '../components/PageContent';
import { MergePromptDialog } from '../features/debts/MergePrompt';
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
  const [mergeDialog, setMergeDialog] = useState<{
    counterpartyId: string;
    userName: string;
  } | null>(null);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const openCounterpartyLedger = useOpenCounterpartyLedger();
  const preview = useInvitePreview(isAuthenticated ? token : null);
  const acceptInvite = useAcceptInviteLink();

  async function finishAccept() {
    if (token === null) {
      return;
    }

    try {
      const accepted = await acceptInvite.mutateAsync(token);
      // 成功後先清掉網址上的邀請憑證，再導覽，避免目的頁或複製網址時仍帶著它。
      window.history.replaceState(null, '', '/invite');
      if (accepted.askMerge) {
        setMergeDialog({
          counterpartyId: accepted.counterpartyId,
          userName: accepted.otherUser.name,
        });
      } else {
        openCounterpartyLedger(accepted.counterpartyId);
      }
    } catch {
      // Mutation 保留錯誤供表單顯示；事件處理器不再把同一錯誤拋到頁面外。
    }
  }

  function finishMergePrompt() {
    if (mergeDialog === null) {
      return;
    }
    const { counterpartyId } = mergeDialog;
    setMergeDialog(null);
    openCounterpartyLedger(counterpartyId);
  }

  let content: ReactNode;
  if (token === null) {
    content = (
      <>
        <h1 className={styles.heading}>連結無效或已過期</h1>
        <ReturnLink />
      </>
    );
  } else if (!isAuthenticated) {
    // 未登入時先不預覽；登入狀態變更後同一個 token 會啟動預覽，網址 hash 不必改動。
    content = (
      <>
        <p className={styles.description}>登入後查看邀請</p>
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
          <h1 className={styles.heading}>連結無效或已過期</h1>
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
        acceptError={acceptInvite.error}
        isAccepting={acceptInvite.isPending}
        onAccept={() => void finishAccept()}
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
        {mergeDialog !== null && (
          <MergePromptDialog
            open
            counterpartyId={mergeDialog.counterpartyId}
            userName={mergeDialog.userName}
            onDone={finishMergePrompt}
            onLater={finishMergePrompt}
          />
        )}
      </div>
    </PageContent>
  );
}

function InvitePreviewCard({
  inviterName,
  acceptError,
  isAccepting,
  onAccept,
  onDecline,
}: {
  inviterName: string;
  acceptError: unknown;
  isAccepting: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <>
      <h1 className={styles.heading}>{inviterName} 邀請你連動往來帳</h1>
      <FormError error={acceptError} />
      <div className={styles.actions}>
        <Button variant="secondary" disabled={isAccepting} onClick={onDecline}>
          拒絕
        </Button>
        <Button disabled={isAccepting} onClick={onAccept}>
          接受
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
