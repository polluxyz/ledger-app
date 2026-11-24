import styles from './LineArt.module.css';

const drawings = {
  ledger: (
    <>
      <rect x="13" y="5" width="38" height="46" rx="4" />
      <path d="M21 5v46M29 16h14M29 23h14M29 30h9M9 16h8M9 28h8M9 40h8M41 39h4" />
    </>
  ),
  wallet: (
    <>
      <path d="m13 19 31-9 5 9M12 19h39a4 4 0 0 1 4 4v22H13a5 5 0 0 1-5-5V23a4 4 0 0 1 4-4Z" />
      <path d="M55 26H42a6 6 0 0 0 0 12h13" />
      <circle cx="42" cy="32" r="1.5" />
    </>
  ),
  tag: (
    <>
      <path d="M12 9h22l21 21-20 20-23-23V9ZM32 26l10 10" />
      <circle cx="22" cy="19" r="3" />
    </>
  ),
  person: (
    <>
      <circle cx="32" cy="18" r="9" />
      <path d="M14 46v-4a10 10 0 0 1 10-10h16a10 10 0 0 1 10 10v4H14Z" />
    </>
  ),
};

interface LineArtProps {
  subject: keyof typeof drawings;
  placement: 'card' | 'empty' | 'brand';
}

/** 管理頁與品牌欄共用的裝飾線稿。 */
export function LineArt({ subject, placement }: LineArtProps) {
  return (
    <svg
      className={`${styles.art} ${styles[placement]}`}
      viewBox="0 0 64 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawings[subject]}
    </svg>
  );
}
