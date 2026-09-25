import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmailField } from '../../components/EmailField';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { LINK_INVITE_MESSAGES } from '../../lib/error-messages';
import { useCreateLinkInviteUrl, useSendLinkInvite } from './use-debts';
import styles from './LinkInviteDialog.module.css';

interface LinkInviteDialogProps {
  open: boolean;
  counterpartyId: string;
  counterpartyName: string;
  onClose: () => void;
}

/** 邀請連動的兩種方式放在同一個視窗，讓使用者可以直接選最方便的聯絡方式。 */
export function LinkInviteDialog({
  open,
  counterpartyId,
  counterpartyName,
  onClose,
}: LinkInviteDialogProps) {
  // 關閉時卸載表單子元件，邀請 token 與錯誤都只留在這次開啟的記憶體狀態裡。
  return open ? (
    <LinkInviteDialogBody
      counterpartyId={counterpartyId}
      counterpartyName={counterpartyName}
      onClose={onClose}
    />
  ) : null;
}

function LinkInviteDialogBody({
  counterpartyId,
  counterpartyName,
  onClose,
}: Omit<LinkInviteDialogProps, 'open'>) {
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const linkFieldRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const sendInvite = useSendLinkInvite();
  const createInviteLink = useCreateLinkInviteUrl();

  useEffect(
    () => () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    },
    [],
  );

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendInvite.mutate({ counterpartyId, email: email.trim() }, { onSuccess: onClose });
  }

  function generateLink() {
    setCopied(false);
    createInviteLink.mutate(counterpartyId, {
      onSuccess: (created) => {
        setInviteLink({ token: created.token, expiresAt: created.expiresAt });
        // mutation 回應也帶 token；重設 observer，避免把敏感連結留在表單狀態裡。
        createInviteLink.reset();
      },
    });
  }

  async function copyLink() {
    if (!inviteLink) {
      return;
    }
    const value = `${window.location.origin}/invite#${inviteLink.token}`;
    setCopied(false);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 權限或安全環境不允許剪貼簿時，選取欄位讓使用者仍能手動複製。
      linkFieldRef.current?.focus();
      linkFieldRef.current?.select();
    }
  }

  const showOverviewLink =
    sendInvite.error instanceof ApiError && sendInvite.error.errorCode === 'LINK_INVITE_FROM_THEM';
  const inviteUrl = inviteLink ? `${window.location.origin}/invite#${inviteLink.token}` : '';

  return (
    <Dialog open title={`邀請連動：${counterpartyName}`} onClose={onClose}>
      <div className={styles.content}>
        <p className={styles.explanation}>
          對方接受後，你們之後記的借還會互相同步。之前的紀錄不會同步。
        </p>

        <section className={styles.section} aria-label="用 email 邀請">
          <form className={styles.emailForm} onSubmit={submitEmail}>
            <EmailField
              label="對方註冊用的 email"
              value={email}
              required
              disabled={sendInvite.isPending}
              onChange={setEmail}
            />
            <Button type="submit" disabled={sendInvite.isPending}>
              {sendInvite.isPending ? '送出中…' : '送出'}
            </Button>
          </form>
          <FormError error={sendInvite.error} messages={LINK_INVITE_MESSAGES} />
          {showOverviewLink && (
            <Link className={styles.overviewLink} to="/">
              到總覽接受
            </Link>
          )}
        </section>

        <div className={styles.orDivider} aria-hidden="true">
          <span>或</span>
        </div>

        <section className={styles.section} aria-label="產生邀請連結">
          <Button
            type="button"
            variant="secondary"
            disabled={createInviteLink.isPending}
            onClick={generateLink}
          >
            {createInviteLink.isPending ? '產生中…' : inviteLink ? '重新產生' : '產生邀請連結'}
          </Button>
          <FormError error={createInviteLink.error} messages={LINK_INVITE_MESSAGES} />
          {inviteLink && (
            <>
              <div className={styles.linkRow}>
                <label className={styles.linkField}>
                  <span>邀請連結</span>
                  <input ref={linkFieldRef} type="text" readOnly value={inviteUrl} />
                </label>
                <Button type="button" variant="secondary" onClick={() => void copyLink()}>
                  {copied ? '已複製' : '複製'}
                </Button>
              </div>
              <p className={styles.expiry}>
                有效到 {formatLocalTime(inviteLink.expiresAt)}。只能用一次，重新產生會讓舊連結失效。
              </p>
            </>
          )}
        </section>

        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** 邀請到期時間使用瀏覽器本地時區，並固定 24 小時制方便直接核對。 */
function formatLocalTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
