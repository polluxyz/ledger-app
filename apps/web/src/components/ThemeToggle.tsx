import { useTheme, type ThemePreference } from '../app/use-theme';
import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import styles from './ThemeToggle.module.css';

/** 按鈕文字與 title 顯示「目前狀態」，按下去才換到下一個。 */
const THEME_LABELS: Record<ThemePreference, string> = {
  system: '外觀：跟隨系統',
  light: '外觀：淺色',
  dark: '外觀：深色',
};

const THEME_ICONS: Record<ThemePreference, IconName> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
};

interface ThemeToggleProps {
  /**
   * 套在文字 `<span>` 上的 class。側欄把自己 module 裡「收合時視覺隱藏」的
   * class 傳進來——收合的判斷（使用者切換或 901–1199px）都在側欄的 CSS 裡，
   * 這個元件不需要知道斷點。
   */
  labelClassName?: string;
}

/**
 * 深淺色切換鈕（phase-2h D19、SC-29.1）。
 *
 * 一顆按鈕循環三種狀態（跟隨系統 → 淺色 → 深色），文字與圖示顯示**目前**狀態。
 * 刻意不做三顆並排：收合後的側欄只有 72px，放不下；做兩份 DOM 又會讓同一個
 * 控制項出現兩次（spec §4.5 否決過）。文字包在 `<span>` 且可由呼叫端蓋 class，
 * 是為了側欄收合時能只留圖示、名稱仍讀得到。
 *
 * 訪客頂列與登入後的側欄各放一顆，兩者不會同時渲染（訪客沒有側欄）。
 */
export function ThemeToggle({ labelClassName }: ThemeToggleProps) {
  const { preference, cycle } = useTheme();
  const label = THEME_LABELS[preference];

  return (
    <button type="button" className={styles.toggle} onClick={cycle} title={label}>
      <Icon name={THEME_ICONS[preference]} />
      <span className={labelClassName}>{label}</span>
    </button>
  );
}
