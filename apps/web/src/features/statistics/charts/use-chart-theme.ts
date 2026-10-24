import { useEffect, useState } from 'react';
import type { ChartTheme } from './chart-colors';

/** 依目前文件屬性或系統偏好追蹤圖表使用的深淺色主題。 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readChartTheme);

  useEffect(() => {
    const root = document.documentElement;
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const update = () => setTheme(readChartTheme());
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    media?.addEventListener?.('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  return theme;
}

function readChartTheme(): ChartTheme {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') {
    return explicit;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
