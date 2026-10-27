import styles from './HomeTrendHeader.module.css';

export type HomeTrendMetric = 'assets' | 'net';

/** 左資產、右結餘，滑動底板沿用網站動畫設定；沒有帳本時不顯示可用的結餘入口。 */
export function HomeTrendHeader({
  metric,
  onChange,
  ledgerName,
}: {
  metric: HomeTrendMetric;
  onChange: (metric: HomeTrendMetric) => void;
  ledgerName?: string;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>
        <span aria-hidden="true">財務趨勢</span>
        <span className={styles.scope}>
          {metric === 'net' ? ledgerName : '我的帳戶'} · 最近 12 個月
        </span>
      </div>
      <div className={styles.switch} data-metric={metric} role="group" aria-label="趨勢指標">
        {(['assets', 'net'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={metric === value}
            disabled={value === 'net' && !ledgerName}
            title={value === 'net' && !ledgerName ? '建立帳本後可查看每月結餘' : undefined}
            onClick={() => onChange(value)}
          >
            {value === 'assets' ? '總資產變化' : '每月結餘'}
          </button>
        ))}
      </div>
    </div>
  );
}
