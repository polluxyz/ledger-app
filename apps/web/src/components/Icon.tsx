import { ICON_PATHS, type IconName } from './icon-paths';

interface IconProps {
  name: IconName;
  /** 像素，預設 16。 */
  size?: number;
  className?: string;
}

/**
 * 全站圖示。inline SVG，不引入圖示套件（phase-2h D6b）。
 *
 * 筆畫資料與規格在 `icon-paths.tsx`；顏色跟著文字（`currentColor`）。
 *
 * **圖示一律是裝飾。** `aria-hidden`，螢幕閱讀器與 e2e 讀的是旁邊的文字或按鈕的
 * `aria-label`——只放圖示、不給名稱的按鈕是無障礙的洞，也會讓 e2e 找不到它。
 */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
