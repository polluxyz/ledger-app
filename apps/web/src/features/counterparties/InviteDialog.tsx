import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmailField } from '../../components/EmailField';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { LINK_INVITE_MESSAGES } from '../../lib/error-messages';
import { useCreateInviteLink, useSendLinkInvite } from '../linking/use-linking';
import styles from './InviteDialog.module.css';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 對象頁的邀請不先挑選任何人；對方接受後，後端會各自建立已連動的對象。
 * 內層表單只在 Dialog 開啟時存在，關閉就連同連結 token 一起卸載。
 */
export function InviteDialog({ open, onClose }: InviteDialogProps) {
  return (
    <Dialog open={open} title="邀請連動" onClose={onClose}>
      <InviteDialogForm onClose={onClose} />
    </Dialog>
  );
}

function InviteDialogForm({ onClose }: Pick<InviteDialogProps, 'onClose'>) {
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const linkFieldId = useId();
  const sendInvite = useSendLinkInvite();
  const createInviteLink = useCreateInviteLink();
  const copyResetTimer = useRef<number | null>(null);
  const linkUrl = inviteLink ? `${window.location.origin}/invite#${inviteLink.token}` : '';

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim() === '' || sendInvite.isPending) {
      return;
    }
    createInviteLink.reset();
    sendInvite.mutate({ email: email.trim() }, { onSuccess: onClose });
  }

  function generateInviteLink() {
    sendInvite.reset();
    setCopied(false);
    clearCopyResetTimer();
    createInviteLink.mutate(undefined, {
      onSuccess: (created) => {
        setInviteLink(created);
        // token 已經交給表單自己的 state 保存；清掉 mutation 結果，避免 hook 另外留一份。
        createInviteLink.reset();
      },
    });
  }

  async function copyInviteLink() {
    if (!inviteLink) {
      return;
    }
    setCopied(false);
    clearCopyResetTimer();
    try {
      if (!window.navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await window.navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const input = document.getElementById(linkFieldId);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
  }

  function clearCopyResetTimer() {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
  }

  const error = sendInvite.error ?? createInviteLink.error;

  return (
    <form className={styles.form} onSubmit={submitInvite}>
      <EmailField
        label="對方的 email"
        value={email}
        required
        disabled={sendInvite.isPending}
        onChange={setEmail}
      />
      <FormError error={error} messages={LINK_INVITE_MESSAGES} />
      <Button type="submit" block disabled={email.trim() === '' || sendInvite.isPending}>
        傳送邀請
      </Button>

      <div className={styles.separator}>或</div>

      <Button
        type="button"
        variant="secondary"
        block
        disabled={createInviteLink.isPending}
        onClick={generateInviteLink}
      >
        {inviteLink ? '重新產生' : '產生連結'}
      </Button>

      {inviteLink && (
        <div className={styles.inviteLink}>
          <TextField id={linkFieldId} label="邀請連結" value={linkUrl} readOnly />
          <div className={styles.linkMeta}>
            <span>{formatExpiryTime(inviteLink.expiresAt)} 前有效</span>
            <Button
              type="button"
              variant="secondary"
              className={styles.copyButton}
              onClick={() => void copyInviteLink()}
            >
              {copied ? '已複製' : '複製'}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onClose}>
          關閉
        </Button>
      </div>
    </form>
  );
}

/** 有效時間依使用者本地時區顯示，並固定使用 24 小時的時與分。 */
function formatExpiryTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
