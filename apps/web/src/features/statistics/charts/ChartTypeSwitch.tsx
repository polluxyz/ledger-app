import type { ChartType } from './chart-types';
import styles from './ChartTypeSwitch.module.css';

/** 圖型切換以文字按鈕呈現目前狀態，保留原生 Enter 與 Space 鍵操作。 */
export interface ChartTypeOption {
  value: ChartType;
  label: string;
}

export interface ChartTypeSwitchProps {
  label: string;
  options: readonly ChartTypeOption[];
  value: ChartType;
  onChange: (value: ChartType) => void;
}

export function ChartTypeSwitch({ label, options, value, onChange }: ChartTypeSwitchProps) {
  return (
    <div className={styles.switch} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
