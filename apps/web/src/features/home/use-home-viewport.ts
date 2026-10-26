import { useEffect, useState } from 'react';

/** 首頁依 900px 視窗斷點切換固定一欄版面，編輯器與 renderer 共用同一個判斷。 */
export function useHomeViewportIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(matchesNarrowViewport);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setIsNarrow(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);

  return isNarrow;
}

function matchesNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 900px)').matches
  );
}
