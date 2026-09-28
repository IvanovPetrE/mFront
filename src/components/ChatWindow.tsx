import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { messagesApi } from "../api/messages";
import { chatsApi } from "../api/chats";
import { ApiError, errorMessage } from "../api/http";
import { useChatSocket } from "../ws/useChatSocket";
import type { ChatListItem, MessageOut } from "../api/types";
import { usePageAttention } from "../hooks/usePageAttention";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useSeenSeq } from "../hooks/useSeenSeq";
import { useToday } from "../hooks/useToday";
import {
  applyStatus,
  displayStatuses,
  lastSeq,
  mergeLatestPage,
  messagesToMarkRead,
  removeMessage,
  upsertMessage,
} from "../utils/messages";
import { formatDayLabel, isSameDay, withinMinutes } from "../utils/dates";
import { plural } from "../utils/plural";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { IconArrowDown, IconBack, IconLock } from "./icons";

const PAGE_SIZE = 50;

// Если собеседник закрыл вкладку/потерял связь ровно во время набора
// текста, событие "is_typing: false" может не дойти вообще — индикатор
// "печатает…" тогда завис бы навсегда. Подчищаем его сами. Значение
// обязано быть больше интервала повторной отправки "is_typing: true"
// (TYPING_THROTTLE_MS = 2500 в useChatSocket), иначе при непрерывном
// наборе индикатор будет мигать.
const TYPING_STALE_MS = 4000;

// На каком расстоянии от низа ленты считаем, что пользователь «внизу».
const STICK_THRESHOLD_PX = 80;

// Сообщения одного автора подряд с паузой меньше этой склеиваются в серию:
// общий аватар, имя только над первым, плотнее отступы.
const SERIES_GAP_MINUTES = 5;

function sameSeries(a: MessageOut | null, b: MessageOut | null): boolean {
  return (
    !!a &&
    !!b &&
    a.kind !== "system" &&
    b.kind !== "system" &&
    a.user_id === b.user_id &&
    isSameDay(a.created_at, b.created_at) &&
    withinMinutes(a.created_at, b.created_at, SERIES_GAP_MINUTES)
  );
}

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/**
 * Окно одного чата.
 *
 * ВАЖНО: родитель рендерит его с `key={chat.id}`, поэтому при переключении
 * чата компонент создаётся заново. Раньше экземпляр переиспользовался, и
 * всё локальное состояние приходилось сбрасывать руками — и сбрасывалось
 * не всё: «печатает…» из прошлого чата переезжал в новый, а ответ на
 * загрузку сообщений старого чата мог прийти позже и затереть новый.
 */
export function ChatWindow({
  chat,
  title,
  avatar,
  currentUserId,
  peopleById,
  avatarById,
  onBack,
  onAccessLost,
  onUnknownUsers,
}: {
  chat: ChatListItem;
  title: string;
  /** Аватар чата для шапки (собеседник или группа). */
  avatar: ReactNode;
  currentUserId: string;
  /** id -> display_name. */
  peopleById: Map<string, string>;
  /** id -> avatar_url (может отсутствовать). */
  avatarById: Map<string, string | null>;
  /** Кнопка «назад» — видна только на узком экране. */
  onBack: () => void;
  /** Доступа к чату больше нет (вышли, исключили, чат удалён). */
  onAccessLost: (chatId: string) => void;
  /** Встретились id, которых нет в справочнике имён (новые пользователи). */
  onUnknownUsers: (ids: string[]) => void;
}) {
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [accessLost, setAccessLost] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const attentive = usePageAttention();
  const today = useToday();

  const listRef = useRef<HTMLDivElement>(null);
  // Последний отрисованный список — чтобы запрос страницы знал, какие
  // сообщения были известны ДО его отправки (см. mergeLatestPage).
  const messagesRef = useRef(messages);
  const stickToBottomRef = useRef(true);
  const prevLastIdRef = useRef<string | null>(null);
  // Номер последнего запроса страницы: ответ от более раннего (например,
  // первичная загрузка, обогнанная загрузкой после реконнекта) игнорируем.
  const loadGenerationRef = useRef(0);
  const markedReadRef = useRef<Set<string>>(new Set());
  const lastMarkedSeqRef = useRef(0);
  // Таймеры авто-очистки "печатает…" по каждому пользователю отдельно —
  // в групповом чате может печатать сразу несколько человек.
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Колбэки родителя — через ref: иначе, если родитель передаст новую
  // функцию на каждом рендере (не обернёт в useCallback), loadLatest ниже
  // будет пересоздаваться, эффект загрузки — перезапускаться, и получится
  // бесконечный цикл запросов. Компонент не должен зависеть от того,
  // насколько аккуратно его используют.
  const parentCallbacks = useRef({ onAccessLost, onUnknownUsers });
  parentCallbacks.current = { onAccessLost, onUnknownUsers };

  const loseAccess = useCallback(() => {
    setAccessLost(true);
    parentCallbacks.current.onAccessLost(chat.id);
  }, [chat.id]);

  const loadLatest = useCallback(
    async (mode: "initial" | "resync") => {
      const generation = ++loadGenerationRef.current;
      const knownSeq = lastSeq(messagesRef.current);
      if (mode === "initial") setLoad({ kind: "loading" });
      try {
        const page = await messagesApi.list(chat.id, { limit: PAGE_SIZE });
        if (generation !== loadGenerationRef.current) return;
        setMessages((prev) => mergeLatestPage(prev, page.items, knownSeq));
        setLoad({ kind: "ready" });
      } catch (e) {
        if (generation !== loadGenerationRef.current) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          loseAccess();
          return;
        }
        // Неудачная фоновая синхронизация не должна прятать уже показанные
        // сообщения — ошибку показываем, только если показывать нечего.
        if (mode === "initial") setLoad({ kind: "error", message: errorMessage(e) });
        else console.warn("[chat] не удалось синхронизировать сообщения после реконнекта", e);
      }
    },
    [chat.id, loseAccess],
  );

  useEffect(() => {
    loadLatest("initial");
    const typingTimeouts = typingTimeoutsRef.current;
    return () => {
      // Поздний ответ после ухода из чата будет проигнорирован.
      loadGenerationRef.current++;
      typingTimeouts.forEach((t) => clearTimeout(t));
      typingTimeouts.clear();
    };
  }, [loadLatest]);

  // --- Автоскролл -----------------------------------------------------------
  // Раньше лента прыгала вниз на КАЖДОЕ изменение messages — даже когда
  // человек читал историю выше, а собеседнику просто обновился статус.
  // Теперь прокручиваем, только если пользователь и так был внизу.

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    if (atBottom) setHasUnseenBelow(false);
  }

  function scrollToBottom() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setHasUnseenBelow(false);
  }

  useLayoutEffect(() => {
    messagesRef.current = messages;
    const lastId = messages.at(-1)?.id ?? null;
    const newAtBottom = lastId !== null && lastId !== prevLastIdRef.current;
    prevLastIdRef.current = lastId;
    if (stickToBottomRef.current) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (newAtBottom) {
      setHasUnseenBelow(true);
    }
  }, [messages]);

  // Лента меняет высоту без новых сообщений: растёт поле ввода (до 6 строк),
  // выезжает клавиатура на телефоне, появляется баннер. scrollTop при этом не
  // меняется, и последние сообщения уезжали под поле. Если человек был внизу —
  // остаёмся внизу.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastHeight = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === lastHeight) return;
      lastHeight = el.clientHeight;
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Прочтение ------------------------------------------------------------
  // Отмечаем только то, что человек действительно видел: сообщение побывало
  // на экране, пока вкладка была видима и окно в фокусе (useSeenSeq). Раньше
  // «прочитано» уходило на всё загруженное — в том числе на сообщение,
  // пришедшее, пока человек читал историю выше.
  //
  // И не по запросу на сообщение: POST /status уходит одному, самому новому
  // увиденному сообщению каждого автора (messagesToMarkRead), а отправитель
  // сам распространяет «прочитано» на более ранние (displayStatuses).
  // Раньше открытие чата с 20 непрочитанными давало 20 параллельных POST.
  const seenSeq = useSeenSeq(listRef, attentive, messages);

  useEffect(() => {
    if (load.kind !== "ready" || accessLost || seenSeq === 0) return;

    if (seenSeq > lastMarkedSeqRef.current) {
      const previous = lastMarkedSeqRef.current;
      lastMarkedSeqRef.current = seenSeq;
      chatsApi.markRead(chat.id, seenSeq).catch(() => {
        lastMarkedSeqRef.current = previous;
      });
    }

    // /status может звать только не-автор (иначе 403) — messagesToMarkRead
    // свои и системные сообщения уже отсекает.
    for (const m of messagesToMarkRead(messages, seenSeq, currentUserId)) {
      if (markedReadRef.current.has(m.id)) continue;
      markedReadRef.current.add(m.id);
      messagesApi.setStatus(m.id, "read").catch(() => {
        markedReadRef.current.delete(m.id);
      });
    }
  }, [seenSeq, load.kind, accessLost, messages, chat.id, currentUserId]);

  // --- Неизвестные авторы ---------------------------------------------------
  useEffect(() => {
    const unknown = new Set<string>();
    for (const m of messages) {
      if (m.user_id && !peopleById.has(m.user_id)) unknown.add(m.user_id);
    }
    if (unknown.size) parentCallbacks.current.onUnknownUsers(Array.from(unknown));
  }, [messages, peopleById]);

  // --- Realtime -------------------------------------------------------------
  const { connected, sendTyping } = useChatSocket(chat.id, {
    onMessageCreated: (m) => setMessages((prev) => upsertMessage(prev, m)),
    onMessageUpdated: (m) => setMessages((prev) => upsertMessage(prev, m)),
    onMessageDeleted: (id) => setMessages((prev) => removeMessage(prev, id)),
    onMessageStatus: (messageId, status) => setMessages((prev) => applyStatus(prev, messageId, status)),
    onReconnected: () => {
      // Пока WS был разорван, мы могли пропустить события — Redis pub/sub
      // их не буферизует. Перезапрашиваем последнюю страницу и вливаем её
      // в список (не заменяем: см. mergeLatestPage).
      loadLatest("resync");
    },
    onAccessLost: loseAccess,
    onTyping: (userId, username, isTyping) => {
      if (userId === currentUserId) return;

      const existing = typingTimeoutsRef.current.get(userId);
      if (existing) clearTimeout(existing);
      typingTimeoutsRef.current.delete(userId);

      const displayName = username || peopleById.get(userId) || "Кто-то";
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (isTyping) next.set(userId, displayName);
        else next.delete(userId);
        return next;
      });

      if (isTyping) {
        const timeout = setTimeout(() => {
          typingTimeoutsRef.current.delete(userId);
          setTypingUsers((prev) => {
            if (!prev.has(userId)) return prev;
            const next = new Map(prev);
            next.delete(userId);
            return next;
          });
        }, TYPING_STALE_MS);
        typingTimeoutsRef.current.set(userId, timeout);
      }
    },
  });

  const showOffline = useDelayedFlag(!connected && !accessLost, 2000);

  async function handleSend(text: string, clientId: string) {
    const msg = await messagesApi.send({ chat_id: chat.id, content: text, client_id: clientId });
    // Своё сообщение показываем сразу по ответу сервера, не дожидаясь
    // message.created по WS: если сокет в этот момент переподключается,
    // раньше сообщение появлялось с задержкой или только после ресинка.
    // Дубль исключён: upsertMessage сверяет id.
    stickToBottomRef.current = true;
    setMessages((prev) => upsertMessage(prev, msg));
  }

  // Раскладка ленты зависит только от сообщений и справочников. Без useMemo
  // она пересобиралась на каждое «печатает…», chat.updated из любого чата и
  // символ в поиске (замер в ревью: все 60 пузырей на каждое событие).
  const renderedDays = useMemo(() => {
    const isGroup = chat.type === "group";
    const now = new Date(today);
    const statuses = displayStatuses(messages, currentUserId);
    // Сообщения раскладываются по дням: у каждого дня своя обёртка с
    // «липкой» плашкой даты. Плашка липнет только в пределах своего дня и
    // выталкивается следующим — иначе все даты, прокрученные вверх,
    // складывались бы стопкой друг на друга.
    const days: Array<{ key: string; label: string; items: ReactNode[] }> = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1] ?? null;
      const next = messages[i + 1] ?? null;
      const newDay = !prev || !isSameDay(prev.created_at, m.created_at);
      const own = m.user_id === currentUserId;
      const groupedPrev = !newDay && sameSeries(prev, m);
      const groupedNext = sameSeries(m, next);
      // В группе у чужих сообщений: имя — над первым в серии, аватар — у
      // последнего (как в привычных мессенджерах). В личном чате и так
      // понятно, кто пишет, — там ни имени, ни аватара.
      const authorId = isGroup && !own ? m.user_id : null;
      const others = authorId !== null;
      const authorName = authorId !== null ? (peopleById.get(authorId) ?? "Участник") : undefined;

      let day = days.at(-1);
      if (newDay || !day) {
        const d = new Date(m.created_at);
        day = {
          key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
          label: formatDayLabel(m.created_at, now),
          items: [],
        };
        days.push(day);
      }
      day.items.push(
        <MessageBubble
          key={m.id}
          message={m}
          status={statuses.get(m.id) ?? m.delivery_status}
          own={own}
          authorName={authorName}
          showAuthorName={others && !groupedPrev}
          authorAvatarUrl={authorId !== null ? avatarById.get(authorId) : undefined}
          avatarSlot={others}
          showAvatar={others && !groupedNext}
          groupedPrev={groupedPrev}
          groupedNext={groupedNext}
        />,
      );
    });

    return days.map((day) => (
      <div className="day-group" key={day.key}>
        <div className="date-separator">
          <span>{day.label}</span>
        </div>
        {day.items}
      </div>
    ));
  }, [messages, chat.type, currentUserId, peopleById, avatarById, today]);

  const typingNames = Array.from(typingUsers.values());
  const typingText =
    typingNames.length === 0
      ? ""
      : chat.type === "direct"
        ? "печатает"
        : typingNames.length === 1
          ? `${typingNames[0]?.split(" ")[0] ?? "Кто-то"} печатает`
          : `${typingNames.length} ${plural(typingNames.length, "участник", "участника", "участников")} печатают`;

  let subtitle: ReactNode;
  let subtitleClass = "chat-header-subtitle";
  if (typingText) {
    subtitleClass += " is-typing";
    subtitle = (
      <>
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {typingText}…
      </>
    );
  } else if (showOffline) {
    subtitleClass += " is-offline";
    subtitle = "нет соединения…";
  } else {
    subtitle = chat.type === "group" ? "групповой чат" : "личные сообщения";
  }

  return (
    <section className="chat-window" aria-label={`Чат: ${title}`}>
      <header className="chat-header">
        <button className="icon-btn back-btn" aria-label="Назад к списку чатов" onClick={onBack}>
          <IconBack size={24} />
        </button>
        {avatar}
        <div className="chat-header-info">
          <h2 className="chat-header-title">{title}</h2>
          {/* aria-live: скринридер сообщит «печатает…» и «нет соединения…». */}
          <div className={subtitleClass} aria-live="polite">
            {subtitle}
          </div>
        </div>
      </header>

      {accessLost && (
        <div className="banner banner-danger chat-banner" role="alert">
          <IconLock size={18} />
          <span>У вас больше нет доступа к этому чату.</span>
        </div>
      )}

      <div className="message-list-wrap">
        <div
          className="message-list"
          ref={listRef}
          onScroll={handleScroll}
          role="log"
          aria-label={`Сообщения: ${title}`}
        >
          <div className="message-column">
            {load.kind === "loading" && (
              <div className="list-placeholder">
                <span className="spinner" aria-hidden="true" />
                Загрузка сообщений…
              </div>
            )}
            {load.kind === "error" && (
              <div className="list-placeholder" role="alert">
                <p>{load.message}</p>
                <button className="btn btn-primary" onClick={() => loadLatest("initial")}>
                  Повторить
                </button>
              </div>
            )}
            {load.kind === "ready" && messages.length === 0 && (
              <div className="list-placeholder">
                <span className="placeholder-emoji" aria-hidden="true">👋</span>
                Сообщений пока нет — напишите первым.
              </div>
            )}
            {renderedDays}
          </div>
        </div>
        {hasUnseenBelow && (
          <button className="new-messages-btn" onClick={scrollToBottom}>
            Новые сообщения
            <IconArrowDown size={16} />
          </button>
        )}
      </div>

      <MessageInput onSend={handleSend} onTyping={sendTyping} disabled={accessLost} />
    </section>
  );
}
