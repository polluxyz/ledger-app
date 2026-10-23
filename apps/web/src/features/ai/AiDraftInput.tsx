import { useRef, useState, type FormEvent } from 'react';
import type { TransactionDraft } from '@ledger/shared';
import { AI_TEXT_MAX_LENGTH } from '@ledger/shared';
import { ApiError } from '../../lib/api-client';
import { toDateInputValue } from '../../lib/format';
import { Button } from '../../components/Button';
import { useAiParse } from './use-ai-parse';
import styles from './AiDraftInput.module.css';

interface AiDraftInputProps {
  ledgerId: string;
  onParsed: (drafts: TransactionDraft[]) => void;
}

/** 交易頁的 AI 輸入列；只負責送出句子並把解析草稿交回頁面暫存。 */
export function AiDraftInput({ ledgerId, onParsed }: AiDraftInputProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  const { parse, isPending } = useAiParse();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || text.trim() === '') return;

    submitting.current = true;
    setMessage(null);
    try {
      const response = await parse({ text: text.trim(), ledgerId, today: toDateInputValue() });
      if (response.drafts.length === 0) {
        setMessage('看不懂，換個說法再試。');
        return;
      }
      onParsed(response.drafts);
      setText('');
    } catch (error) {
      setMessage(getParseErrorMessage(error));
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className={styles.section} aria-labelledby="ai-draft-input-title">
      <h2 id="ai-draft-input-title" className={styles.title}>
        AI 記帳
      </h2>
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
        <label className={styles.visuallyHidden} htmlFor="ai-transaction-text">
          用一句話記帳
        </label>
        <input
          id="ai-transaction-text"
          className={styles.input}
          type="text"
          value={text}
          maxLength={AI_TEXT_MAX_LENGTH}
          placeholder="例如：早餐 60 現金、午餐 120 刷卡"
          disabled={isPending}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" disabled={isPending || text.trim() === ''}>
          {isPending ? '處理中…' : '送出'}
        </Button>
      </form>
      {message !== null && (
        <p className={styles.message} role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

function getParseErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'AI 暫時沒有回應，請稍後再試。';
  if (error.statusCode === 429 || error.errorCode === 'TOO_MANY_REQUESTS') {
    return '太頻繁了，等一分鐘再試。';
  }
  if (error.errorCode === 'AI_NOT_CONFIGURED') return 'AI 記帳還沒啟用。';
  if (error.errorCode === 'AI_UNAVAILABLE') return 'AI 暫時沒有回應，請稍後再試。';
  return '送出失敗，請稍後再試。';
}
