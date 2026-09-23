/**
 * 每個測試檔執行前載入。引入 jest-dom 以取得 `toBeInTheDocument` 等
 * DOM 專用的斷言，讓元件測試讀起來更貼近使用者觀點。
 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

/**
 * `findBy*` 這類非同步查詢的等待上限，從預設的 1000ms 放寬到 5000ms。
 *
 * 根目錄的 `pnpm test` 會讓 api 的 Jest 與 web 的 vitest **同時**跑。CPU 吃滿時，
 * 元件從送出請求到把結果畫出來會多花幾百毫秒，1000ms 的餘裕太薄——
 * `transaction-edit`、`transfer`、`ledgers` 都被觀察到在這種情況下逾時。
 * 那些不是邏輯錯誤：同一個檔案單獨跑一律通過。
 *
 * 這裡只延長「最多等多久」，不改任何斷言。通過的測試不會因此變慢：查詢一找到
 * 元素就回來，多出來的等待只發生在真的失敗的那一次。
 */
configure({ asyncUtilTimeout: 5000 });

/**
 * jsdom 尚未實作 `<dialog>` 的 `showModal()`、`show()` 與 `close()`，補上最小的替身。
 * `show()` 是非 modal 面板用的（`components/Dialog.tsx` 的 `panel` 變體，phase-2h）。
 *
 * 放在這裡是因為它與「測哪一個元件」無關——只要畫面上出現彈窗就需要它。
 * 這段原本在 7 個測試檔各有一份（Slice 1 的 S1-D5 刻意暫時重複，等重構被證明
 * 安全再收攏），Slice 3 開工前收攏於此。
 *
 * 每個測試都重新建立替身，呼叫次數才不會累積到下一個測試。要斷言它被呼叫過，
 * 直接讀 `HTMLDialogElement.prototype.showModal`（見 `components/Dialog.test.tsx`）。
 */
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.show = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});
