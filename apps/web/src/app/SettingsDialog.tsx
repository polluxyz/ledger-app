import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useMotion } from './use-motion';
import { useTheme, type ThemePreference } from './use-theme';
import styles from './SettingsDialog.module.css';

/**
 * 設定彈窗（2i · SC-32.2，第二輪修訂）。
 *
 * 第一輪把「外觀」做成使用者選單往右浮出的第二層，開發者看過畫面後改掉了：
 * 設定要跳出彈窗。所以這裡用 `components/Dialog` 的 modal 變體——焦點鎖定、
 * 背景遮罩、Esc 關閉都由原生 `<dialog>` 提供，不必自己實作也不必多一個相依。
 *
 * 第三輪加了第二組「動畫」（SC-39）。版面（群組標題 ＋ 底部說明）本來就是為了
 * 「之後還會加東西」而留的，這次就照原樣多疊一組，不必改結構。
 *
 * 三件事值得先說明：
 *
 * 1. **用 `role="radio"` 而不是原生 `<input type="radio">`。** 卡片裡有一塊預覽圖，
 *    原生 radio 沒辦法把那塊圖變成自己的「點擊區」。代價是方向鍵移動要自己寫
 *    （見 `handleKeyDown`），但換得的是「整張卡都能點」。
 * 2. **選了不關閉彈窗。** 外觀是立刻生效的，留著才看得到自己選了哪一張。
 * 3. **焦點回到哪裡由呼叫端決定。** 這個彈窗是從使用者選單的「設定」打開的，
 *    而那顆按鈕在彈窗打開的同時就隨著選單一起消失了，原生的焦點回歸救不了它。
 *    `UserMenu` 在 `onClose` 裡把焦點送回使用者觸發鈕。
 */
interface SettingsDialogProps {
  open: boolean;
  /** 使用者按關閉鈕、Esc 或點背景時呼叫。由呼叫端把 `open` 改成 false。 */
  onClose: () => void;
}

const APPEARANCE_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '跟隨系統' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  return (
    <Dialog open={open} title="設定" onClose={onClose}>
      <SettingsBody onClose={onClose} />
    </Dialog>
  );
}

/**
 * 彈窗的內容。拆成獨立元件是因為 `Dialog` 關閉時整個卸載（見 `Dialog.tsx`），
 * 底下的 hook 因此不會在關閉狀態下白跑。
 */
function SettingsBody({ onClose }: { onClose: () => void }) {
  const { preference, choose } = useTheme();
  const { enabled: motionEnabled, setEnabled: setMotionEnabled } = useMotion();
  const groupRef = useRef<HTMLDivElement | null>(null);

  /** 選一張卡並把焦點留在它身上（roving tabindex 的另一半）。 */
  const select = useCallback(
    (next: ThemePreference) => {
      choose(next);
      groupRef.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
    },
    [choose],
  );

  /*
   * 點背景關閉。
   *
   * 原生 `<dialog>` 不做這件事，而遮罩（`::backdrop`）不是獨立節點——點在上面時
   * 事件的 target 就是 `<dialog>` 本身。所以判斷條件是「target 正好是外框」：
   * 點在卡片上會冒泡上來，但 target 是卡片，不會誤關。
   *
   * 監聽器掛在外框而不是自己的節點上，因為背景根本不在自己的子樹裡。外框是
   * `Dialog` 的實作細節，這裡用 `closest('dialog')` 取回來，不改 `Dialog` 的介面
   * ——背景關閉只有這個彈窗要，其他彈窗（編輯表單）誤點就關掉反而會弄丟輸入。
   */
  useEffect(() => {
    const frame = groupRef.current?.closest('dialog');
    if (!frame) {
      return;
    }
    function handleClick(event: MouseEvent) {
      if (event.target === frame) {
        onClose();
      }
    }
    frame.addEventListener('click', handleClick);
    return () => frame.removeEventListener('click', handleClick);
  }, [onClose]);

  /*
   * 方向鍵在三張卡之間移動**並且選取**（roving tabindex 的標準行為，與原生
   * radio 群組一致）。走到頭會繞回另一端，不會卡住。
   * 要 `preventDefault`，否則 ↑↓ 會順便捲動彈窗。
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = stepOf(event.key);
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const current = APPEARANCE_OPTIONS.findIndex((option) => option.value === preference);
    const index = current === -1 ? 0 : current;
    const next =
      APPEARANCE_OPTIONS[(index + step + APPEARANCE_OPTIONS.length) % APPEARANCE_OPTIONS.length];
    if (next) {
      select(next.value);
    }
  }

  return (
    <div className={styles.body}>
      <section className={styles.group}>
        <h3 className={styles.groupLabel}>外觀</h3>
        {/*
          `aria-label` 而不是 `aria-labelledby` 指向上面那個標題：SC-32.2 要求群組的
          無障礙名稱就是「外觀」，兩者結果相同，但 label 少一個要維護的 id。
        */}
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="外觀"
          className={styles.cards}
          onKeyDown={handleKeyDown}
        >
          {APPEARANCE_OPTIONS.map((option) => {
            const checked = preference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                // roving tabindex：整組只有被選中的那張進得了 Tab 順序，
                // 其餘靠方向鍵走到。沒有它的話 Tab 要按三次才穿得過這一組。
                tabIndex={checked ? 0 : -1}
                data-value={option.value}
                className={[styles.card, checked ? styles.cardSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => choose(option.value)}
              >
                {/* 預覽是裝飾：卡片的名稱來自下面那行文字。顏色見 module.css。 */}
                <span className={styles.preview} aria-hidden="true">
                  <span className={styles.previewChrome} />
                  <span className={styles.previewContent} />
                </span>
                <span className={styles.cardLabel}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupLabel}>動畫</h3>
        {/*
          `role="switch"` 的按鈕，名稱就是裡面那行「動畫」的文字（SC-39.1）。
          用按鈕而不是原生 checkbox：外觀要與上面三張卡同一套 token，而 checkbox
          的打勾框在各瀏覽器長得不一樣，藏掉再自己畫等於繞遠路做同一件事。

          開關是**立刻生效**的——按下去的同時 `<html data-motion>` 就變了，所以
          滑塊自己的動畫在關閉的那一次會跟著變成 0ms。那正是我們要的：關了動畫
          之後，連這顆開關都不再動。
        */}
        <button
          type="button"
          role="switch"
          aria-checked={motionEnabled}
          className={styles.switchRow}
          onClick={() => setMotionEnabled(!motionEnabled)}
        >
          <span className={styles.switchLabel}>動畫</span>
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchThumb} />
          </span>
        </button>
        <p className={styles.hint}>關閉後，側欄與右側欄的開合會直接切換。</p>
      </section>

      <p className={styles.hint}>之後的設定也會放在這裡。</p>
    </div>
  );
}

/** 方向鍵換算成位移。左右與上下都收：卡片橫排，但鍵盤使用者兩種都會按。 */
function stepOf(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1;
  }
  return 0;
}
