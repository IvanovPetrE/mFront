import { useEffect, useState } from "react";
import { useDocumentVisible } from "./useDocumentVisible";

/**
 * true, пока окно браузера в фокусе. Вкладка может быть «видимой», а человек
 * при этом работает в другой программе (окно на втором мониторе или
 * частично перекрыто) — `visibilityState` этого не отличает.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return focused;
}

/**
 * Человек, скорее всего, смотрит на страницу: вкладка на экране И окно в
 * фокусе. Хук из хуков — просто комбинация двух других.
 */
export function usePageAttention(): boolean {
  const visible = useDocumentVisible();
  const focused = useWindowFocused();
  return visible && focused;
}
