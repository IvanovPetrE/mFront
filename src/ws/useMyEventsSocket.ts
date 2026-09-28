import type { WsPersonalEvent } from "../api/types";
import { CLOSE_FORBIDDEN, useReconnectingSocket } from "./useReconnectingSocket";

interface Handlers {
  onChatUpdated?: (chatId: string) => void;
  /**
   * Соединение восстановлено после разрыва: пока его не было, chat.updated
   * могли потеряться, и список чатов надо перезапросить целиком.
   */
  onReconnected?: () => void;
  /** 4403 на личном канале: членство тут не проверяется, значит, отключён сам аккаунт. */
  onAccountDisabled?: () => void;
}

/**
 * Одно WS-соединение на всю сессию (не на конкретный чат) — подписано на
 * личный канал `user:{id}` на бэке (`/ws/me` в ws.py). В отличие от
 * useChatSocket, тут нет typing и нет содержимого сообщений: только пинг
 * "в этом чате что-то произошло", по которому фронт перезапрашивает
 * список чатов. Держать это отдельным соединением, а не переиспользовать
 * useChatSocket текущего открытого чата, проще и правильнее: у
 * /ws/chat/{id} в принципе нет доступа к чужим комнатам, эти два канала
 * решают разные задачи (открытый тред vs список чатов).
 */
export function useMyEventsSocket(enabled: boolean, handlers: Handlers) {
  const { connected } = useReconnectingSocket(enabled ? "/ws/me" : null, {
    onOpen: (isReconnect) => {
      if (isReconnect) handlers.onReconnected?.();
    },
    onFatalClose: (code) => {
      if (code === CLOSE_FORBIDDEN) handlers.onAccountDisabled?.();
    },
    onEvent: (raw) => {
      const msg = raw as WsPersonalEvent;
      if (msg.event === "chat.updated") {
        handlers.onChatUpdated?.(msg.data.chat_id);
      }
    },
  });

  return { connected };
}
