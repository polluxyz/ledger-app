/**
 * 每個測試檔執行前載入。引入 jest-dom 以取得 `toBeInTheDocument` 等
 * DOM 專用的斷言，讓元件測試讀起來更貼近使用者觀點。
 */
import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

/**
 * jsdom 尚未實作 `<dialog>` 的 `showModal()` 與 `close()`，補上最小的替身。
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
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});
