import { useRef } from "react";
import type { DeliveryStatus, MessageOut, WsClientEvent, WsServerEvent } from "../api/types";
import { useReconnectingSocket } from "./useReconnectingSocket";

// Пока человек печатает, "is_typing: true" уходит не чаще раза в этот
// интервал. Раньше событие отправлялось на каждое нажатие клавиши — десятки
// кадров в секунду на весь чат, а троттлинга на бэкенде нет (ревью бэкенда,
// P1-10). Интервал меньше таймаута протухания на стороне получателя
// (TYPING_STALE_MS в ChatWindow), иначе индикатор мигал бы при непрерывном наборе.
const TYPING_THROTTLE_MS = 2500;

interface Handlers {
  onMessageCreated?: (m: MessageOut) => void;
  onMessageUpdated?: (m: MessageOut) => void;
  onMessageDeleted?: (id: string, seq: number) => void;
  onMessageStatus?: (messageId: string, status: DeliveryStatus) => void;
  onTyping?: (userId: string, username: string, isTyping: boolean) => void;
  /**
   * Соединение восстановлено ПОСЛЕ разрыва (не первое открытие). Пока WS
   * был закрыт, любые события — новые сообщения, правки, удаления,
   * статусы — могли уйти "в никуда": у сервера при разрыве нет буфера,
   * который бы их для нас придержал (Redis pub/sub, не очередь с offset'ом,
   * см. websocket.py). GET /messages/{chat_id} умеет отдавать только более
   * старые сообщения (`before_seq`), без "после seq X" — поэтому единственный
   * способ гарантированно наверстать пропущенное — перезапросить страницу
   * заново, а не пытаться докачать дельту.
   */
  onReconnected?: () => void;
  /** 4403 — доступа к чату больше нет (вышли/исключили), 4404 — чата нет. */
  onAccessLost?: (code: number) => void;
}

/** Одно WS-соединение на открытый чат: сообщения, статусы, typing. */
export function useChatSocket(chatId: string | null, handlers: Handlers) {
  // handlers можно читать напрямую: useReconnectingSocket оборачивает
  // колбэки в Effect Events, они всегда видят свежий рендер.
  const lastTypingSentAt = useRef(0);

  const { connected, send } = useReconnectingSocket(chatId ? `/ws/chat/${chatId}` : null, {
    onOpen: (isReconnect) => {
      lastTypingSentAt.current = 0;
      if (isReconnect) handlers.onReconnected?.();
    },
    onFatalClose: (code) => handlers.onAccessLost?.(code),
    // Уходим из чата посреди набора: гасим индикатор у собеседников сразу,
    // а не через их таймаут. Раньше это пытался сделать MessageInput из своего
    // cleanup, но к тому моменту сокет уже был закрыт (cleanup родителя
    // выполняется раньше), и событие молча терялось.
    beforeClose: (send) => {
      if (lastTypingSentAt.current > 0) {
        send({ event: "typing", is_typing: false } satisfies WsClientEvent);
        lastTypingSentAt.current = 0;
      }
    },
    onEvent: (raw) => {
      const msg = raw as WsServerEvent;
      const h = handlers;
      switch (msg.event) {
        case "message.created":
          h.onMessageCreated?.(msg.data);
          break;
        case "message.updated":
          h.onMessageUpdated?.(msg.data);
          break;
        case "message.deleted":
          h.onMessageDeleted?.(msg.data.id, msg.data.seq);
          break;
        case "message_status":
          h.onMessageStatus?.(msg.data.message_id, msg.data.status);
          break;
        case "typing":
          h.onTyping?.(msg.data.user_id, msg.data.username, msg.data.is_typing);
          break;
      }
    },
  });

  function sendTyping(isTyping: boolean) {
    if (isTyping) {
      const now = Date.now();
      if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
      if (send({ event: "typing", is_typing: true } satisfies WsClientEvent)) {
        lastTypingSentAt.current = now;
      }
    } else {
      // "Перестал печатать" отправляем всегда и сбрасываем троттлинг, чтобы
      // следующее нажатие сразу снова включило индикатор у собеседника.
      lastTypingSentAt.current = 0;
      send({ event: "typing", is_typing: false } satisfies WsClientEvent);
    }
  }

  return { connected, sendTyping };
}
