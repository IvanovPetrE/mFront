import { memo, type ReactNode } from "react";
import type { DeliveryStatus, MessageOut } from "../api/types";
import { formatFullDate, formatTime } from "../utils/dates";
import { Avatar, nameColor } from "./Avatar";
import { IconCheck, IconChecks } from "./icons";

const statusLabel: Record<DeliveryStatus, string> = {
  sent: "отправлено",
  delivered: "доставлено",
  read: "прочитано",
};

function StatusIcon({ status }: { status: DeliveryStatus }) {
  if (status === "read") return <IconChecks size={16} className="status-icon read" />;
  if (status === "delivered") return <IconChecks size={16} className="status-icon" />;
  return <IconCheck size={16} className="status-icon" />;
}

/**
 * `memo`: лента перерисовывается на каждое «печатает…», `chat.updated` из
 * любого чата и символ в поиске, а у пузыря при этом не меняется ничего.
 * Все пропсы — примитивы или объект сообщения, который меняется только при
 * правке, поэтому поверхностного сравнения достаточно.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  status,
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
  /**
   * Статус для галочек своего сообщения. Может быть выше, чем
   * `message.delivery_status`: если прочитано следующее своё сообщение,
   * прочитано и это (см. `displayStatuses`).
   */
  status: DeliveryStatus;
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
  // data-seq — для IntersectionObserver в ChatWindow: по нему понятно, какие
  // сообщения человек действительно видел на экране.
  if (message.kind === "system") {
    return (
      <div className="message-system" data-seq={message.seq}>
        {message.content}
      </div>
    );
  }

  const fullDate = formatFullDate(message.created_at);
  const meta: ReactNode = (
    <>
      {message.edited_at && <span title="изменено">изм.</span>}
      <time dateTime={message.created_at} title={fullDate}>
        {formatTime(message.created_at)}
      </time>
      {own && <StatusIcon status={status} />}
    </>
  );

  const rowClass = ["msg-row", own ? "own" : "", groupedPrev ? "grouped-prev" : "", groupedNext ? "grouped-next" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass} data-seq={message.seq}>
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
          {own && <span className="sr-only">, {statusLabel[status]}</span>}
        </span>
      </div>
    </div>
  );
});
