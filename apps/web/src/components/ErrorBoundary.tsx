import { Component, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 這個值一變就清掉錯誤、重新渲染 children。頁面層級傳導覽的 key，一導覽就恢復。 */
  resetKey?: unknown;
  /** 錯誤頁占滿整個視窗（最外層用）；預設只占內容區，側欄與頂列照常可用。 */
  fullScreen?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  resetKey: unknown;
}

/**
 * 錯誤邊界（error boundary）：子元件渲染時丟出例外，就改顯示錯誤頁，而不是整個
 * React 樹被卸載、留下一片黑畫面。
 *
 * 只能用 class 元件寫：React 只透過 `getDerivedStateFromError` 讓元件接住子樹的
 * 例外，沒有對應的 hook。
 *
 * 錯誤頁只有標題與「重新整理」（介面文字極簡）。**刻意不顯示錯誤訊息**：例外內容
 * 可能帶內部細節，對使用者也沒有用；React 會自己把它印到 console 給開發者看。
 * 重新整理會重抓所有資料、也會載入最新的前端程式，比只重繪這一塊更可能恢復。
 *
 * 接不到的錯誤：事件處理器、非同步程式（API 失敗由各頁自己顯示）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { hasError: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { fullScreen = false } = this.props;
    // 外殼裡站名是唯一的 h1，頁面標題是 h2；占滿視窗時外殼已經不在，自己當 h1。
    const Heading = fullScreen ? 'h1' : 'h2';
    return (
      <div className={fullScreen ? styles.fullScreen : styles.page} role="alert">
        <Heading className={styles.title}>畫面出錯了</Heading>
        <Button type="button" onClick={() => window.location.reload()}>
          重新整理
        </Button>
      </div>
    );
  }
}
