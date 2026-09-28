import type { ReactNode } from "react";
import type { MessageOut } from "../api/types";
import { formatTime } from "../utils/dates";
import { Avatar, nameColor } from "./Avatar";
import { IconCheck, IconChecks } from "./icons";

const statusLabel: Record<string, string> = {
  sent: "отправлено",
  delivered: "доставлено",
  read: "прочитано",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "read") return <IconChecks size={16} className="status-icon read" />;
  if (status === "delivered") return <IconChecks size={16} className="status-icon" />;
  return <IconCheck size={16} className="status-icon" />;
}

export function MessageBubble({
  message,
  own,
  authorName,
  showAuthorName = false,
  authorAvatarUrl,
  avatarSlot = false,
  showAvatar = false,
  groupedPrev = false,
  groupedNext = false,
}: {
  message: MessageOut;
  own: boolean;
  /** Имя отправителя (чужие сообщения в группе) — для подписи и инициалов на аватаре. */
  authorName?: string;
  /** Показать имя над текстом — у первого сообщения серии. */
  showAuthorName?: boolean;
  authorAvatarUrl?: string | null;
  /** Оставить слева место под аватар (чужие сообщения в группе), чтобы пузыри серии стояли ровно. */
  avatarSlot?: boolean;
  /** Показать сам аватар — у последнего сообщения серии. */
  showAvatar?: boolean;
  /** Сообщение продолжает серию от того же автора — меньше отступ, скруглённый стык. */
  groupedPrev?: boolean;
  groupedNext?: boolean;
}) {
  // Системные сообщения ("Иван добавил Петра") создаёт только сервер —
  // у них нет автора и им не место в "пузыре" собеседника.
  if (message.kind === "system") {
    return <div className="message-system">{message.content}</div>;
  }

  const fullDate = new Date(message.created_at).toLocaleString("ru-RU");
  const meta: ReactNode = (
    <>
      {message.edited_at && <span title="изменено">изм.</span>}
      <time dateTime={message.created_at} title={fullDate}>
        {formatTime(message.created_at)}
      </time>
      {own && <StatusIcon status={message.delivery_status} />}
    </>
  );

  const rowClass = [
    "msg-row",
    own ? "own" : "",
    groupedPrev ? "grouped-prev" : "",
    groupedNext ? "grouped-next" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass}>
      {avatarSlot && (
        <div className="msg-avatar-slot">
          {showAvatar && message.user_id && (
            <Avatar name={authorName ?? "?"} seed={message.user_id} size={32} url={authorAvatarUrl} />
          )}
        </div>
      )}
      <div className="bubble">
        {authorName && showAuthorName && (
          <div className="bubble-author" style={{ color: nameColor(message.user_id ?? "") }}>
            {authorName}
          </div>
        )}
        <div className="bubble-text">
          {message.content}
          {/* Невидимая копия подписи резервирует место в конце последней строки,
              чтобы текст не заезжал под время и галочки. */}
          <span className="bubble-meta-spacer" aria-hidden="true">
            {meta}
          </span>
        </div>
        <span className="bubble-meta">
          {meta}
          {own && <span className="sr-only">, {statusLabel[message.delivery_status] ?? message.delivery_status}</span>}
        </span>
      </div>
    </div>
  );
}
