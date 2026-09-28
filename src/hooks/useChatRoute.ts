import { useCallback, useEffect, useState } from "react";

// Адрес открытого чата — /c/<id>. Не /chats/<id>: путь /chats/ занят REST API
// (GET /chats/, /chats/<id>/members), и dev-прокси Vite вместе с любым
// будущим reverse proxy отправили бы перезагрузку страницы на бэкенд.
const PREFIX = "/c/";

function chatIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const id = decodeURIComponent(pathname.slice(PREFIX.length));
  return id || null;
}

/** Помечаем запись истории, которую сами добавили при открытии чата из списка. */
interface HistoryState {
  openedFromList?: boolean;
}

/**
 * id открытого чата из адресной строки и функция навигации.
 *
 * Зачем: на телефоне открытый чат закрывает список, и системная «Назад»
 * раньше выкидывала из мессенджера — записи в истории не было. Теперь:
 * - открыли чат из списка → новая запись истории (pushState), «Назад»
 *   системная или кнопкой в шапке возвращает к списку;
 * - переключились с чата на чат → запись заменяется (replaceState), чтобы
 *   «Назад» вела к списку, а не перебирала все открытые чаты;
 * - перезагрузка страницы на /c/<id> открывает тот же чат.
 *
 * Своего хука хватает, пока экран один. Когда появятся другие (профиль,
 * настройки группы), пора переходить на роутер — см. ревью фронтенда.
 */
export function useChatRoute(): [string | null, (chatId: string | null) => void] {
  const [chatId, setChatId] = useState(() => chatIdFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setChatId(chatIdFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string | null) => {
    const current = chatIdFromPath(window.location.pathname);
    if (next === current) return;
    const state = (window.history.state ?? {}) as HistoryState;

    if (next === null) {
      // Мы сами добавили эту запись — просто шагаем назад, как системная
      // кнопка. Иначе (чат открыли по прямой ссылке) заменяем адрес на список.
      if (state.openedFromList) {
        window.history.back(); // setChatId сделает обработчик popstate
        return;
      }
      window.history.replaceState(null, "", "/");
    } else if (current === null) {
      window.history.pushState({ openedFromList: true } satisfies HistoryState, "", PREFIX + encodeURIComponent(next));
    } else {
      window.history.replaceState(state, "", PREFIX + encodeURIComponent(next));
    }
    setChatId(next);
  }, []);

  return [chatId, navigate];
}
