import type { ReactNode } from "react";
import type { ChatListItem } from "../api/types";
import { formatChatTime } from "../utils/dates";
import { IconChat } from "./icons";

export function ChatList({
  chats,
  loaded,
  activeId,
  currentUserId,
  peopleById,
  query = "",
  titleOf,
  avatarOf,
  onSelect,
  onNewChat,
}: {
  chats: ChatListItem[];
  /** Список ещё грузится в первый раз — отличаем от «чатов правда нет». */
  loaded: boolean;
  activeId: string | null;
  currentUserId: string;
  /** id -> display_name — для подписи автора в превью группового чата. */
  peopleById: Map<string, string>;
  /** Строка поиска из сайдбара: фильтр по названию и последнему сообщению. */
  query?: string;
  titleOf: (chat: ChatListItem) => string;
  avatarOf: (chat: ChatListItem, size: number) => ReactNode;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  if (!loaded) {
    return (
      <div className="chat-list-placeholder">
        <span className="spinner" aria-hidden="true" />
        Загрузка чатов…
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="chat-list-empty">
        <div className="empty-icon">
          <IconChat size={28} />
        </div>
        <p className="empty-title">Пока нет чатов</p>
        <p className="empty-text">Начните переписку с коллегой или соберите группу.</p>
        <button className="btn btn-primary" onClick={onNewChat}>
          Новый чат
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? chats.filter(
        (c) =>
          titleOf(c).toLowerCase().includes(q) ||
          (c.last_message?.content.toLowerCase().includes(q) ?? false),
      )
    : chats;

  return (
    <nav className="chat-list" aria-label="Чаты">
      {visible.map((chat) => {
        const active = chat.id === activeId;
        const last = chat.last_message;
        const time = last?.created_at ?? chat.last_message_at;
        // Открытый чат не показывает бейдж, даже если сервер ещё не прислал
        // новое значение unread_count: mark_read на бэкенде не рассылает
        // событие (ревью бэкенда, P1-4), так что до следующего chat.updated
        // по другому поводу бейдж на активном чате был бы враньём.
        const unread = active ? 0 : chat.unread_count;

        let author = "";
        if (last && last.kind !== "system" && last.user_id) {
          if (last.user_id === currentUserId) author = "Вы";
          else if (chat.type === "group") author = (peopleById.get(last.user_id) ?? "").split(" ")[0];
        }

        return (
          <button
            key={chat.id}
            className={`chat-row${active ? " active" : ""}${unread > 0 ? " has-unread" : ""}`}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(chat.id)}
          >
            {avatarOf(chat, 50)}
            <span className="chat-row-body">
              <span className="chat-row-top">
                <span className="chat-row-name">{titleOf(chat)}</span>
                {time && <span className="chat-row-time">{formatChatTime(time)}</span>}
              </span>
              <span className="chat-row-bottom">
                <span className={`chat-row-preview${last?.kind === "system" ? " system" : ""}`}>
                  {!last ? (
                    <span className="muted">Нет сообщений</span>
                  ) : (
                    <>
                      {author && <span className="chat-row-author">{author}: </span>}
                      {last.content}
                    </>
                  )}
                </span>
                {unread > 0 && (
                  <span className="unread-badge" aria-label={`непрочитанных: ${unread}`}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
      {visible.length === 0 && <div className="chat-list-placeholder">Ничего не найдено</div>}
    </nav>
  );
}
