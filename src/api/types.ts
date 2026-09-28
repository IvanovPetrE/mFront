export type ChatType = "direct" | "group";
export type MemberRole = "owner" | "admin" | "member";
export type DeliveryStatus = "sent" | "delivered" | "read";
export type MessageKind = "text" | "image" | "file" | "system";

/** Полный профиль — только про себя, из GET /users/me. */
export interface User {
  id: string;
  external_id: string | null;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Публичная карточка чужого пользователя из GET /users/. После фикса
 * P0-1 на бэкенде список отдаёт только эти три поля — email и
 * external_id чужих людей больше не утекают. Раньше фронт типизировал
 * ответ как полный User и мог бы случайно начать полагаться на email.
 */
export type UserPublic = Pick<User, "id" | "display_name" | "avatar_url">;

/** Лимит длины сообщения — совпадает с max_length в schemas.MessageCreate. */
export const MAX_MESSAGE_LENGTH = 8000;

export interface MessageOut {
  id: string;
  chat_id: string;
  user_id: string | null;
  seq: number;
  kind: MessageKind;
  content: string;
  client_id: string | null;
  reply_to_id: string | null;
  delivery_status: DeliveryStatus;
  created_at: string;
  edited_at: string | null;
}

export interface MessagePage {
  items: MessageOut[];
  next_before_seq: number | null;
  has_more: boolean;
}

export interface ChatMemberOut {
  user_id: string;
  role: MemberRole;
  joined_at: string;
  left_at: string | null;
  last_read_seq: number;
  last_read_at: string | null;
}

export interface ChatOut {
  id: string;
  type: ChatType;
  name: string | null;
  created_at: string;
  last_message_at: string | null;
}

export interface ChatListItem extends ChatOut {
  unread_count: number;
  last_message: MessageOut | null;
}

// --- WS ---

export type WsServerEvent =
  | { event: "message.created"; data: MessageOut }
  | { event: "message.updated"; data: MessageOut }
  | { event: "message.deleted"; data: { id: string; seq: number } }
  // update_message_status в services.py шлёт отдельное событие — не
  // "message.updated", а именно "message_status" (через подчёркивание,
  // без точки), и в data только id+статус, не весь MessageOut.
  | { event: "message_status"; data: { message_id: string; status: DeliveryStatus } }
  // Подтверждено manager.send_typing в websocket.py: событие завёрнуто в
  // "data", а имя приходит как "username" (не "display_name").
  | { event: "typing"; data: { user_id: string; username: string; is_typing: boolean } }
  | { event: "pong" };

export type WsClientEvent =
  | { event: "typing"; is_typing: boolean }
  | { event: "ping" };

// Личный канал /ws/me (см. app/routers/ws.py, app/services.py:
// notify_chat_updated) — события из ВСЕХ чатов пользователя разом,
// без текста сообщений. Нужен, чтобы список чатов обновлялся, даже когда
// открыт другой чат или вообще ни один.
export type WsPersonalEvent =
  | { event: "chat.updated"; data: { chat_id: string } }
  | { event: "pong" };
