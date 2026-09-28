import { useRef } from "react";
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
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const { connected } = useReconnectingSocket(enabled ? "/ws/me" : null, {
    onOpen: (isReconnect) => {
      if (isReconnect) handlersRef.current.onReconnected?.();
    },
    onFatalClose: (code) => {
      if (code === CLOSE_FORBIDDEN) handlersRef.current.onAccountDisabled?.();
    },
    onEvent: (raw) => {
      const msg = raw as WsPersonalEvent;
      if (msg.event === "chat.updated") {
        handlersRef.current.onChatUpdated?.(msg.data.chat_id);
      }
    },
  });

  return { connected };
}
