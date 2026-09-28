import { useEffect, useState } from "react";

/**
 * true, пока вкладка на экране. Нужен, чтобы не отмечать сообщения
 * прочитанными, когда вкладка с открытым чатом свёрнута или спрятана за
 * другими: раньше собеседник видел «прочитано», хотя человека у экрана не было.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
