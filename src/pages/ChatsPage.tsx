import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { chatsApi } from "../api/chats";
import { errorMessage } from "../api/http";
import { usersApi } from "../api/users";
import type { ChatListItem, UserPublic } from "../api/types";
import { Avatar } from "../components/Avatar";
import { ChatList } from "../components/ChatList";
import { ChatWindow } from "../components/ChatWindow";
import { NewChatDialog } from "../components/NewChatDialog";
import { IconChat, IconCompose, IconLogout, IconSearch } from "../components/icons";
import { useMyEventsSocket } from "../ws/useMyEventsSocket";
import { useToday } from "../hooks/useToday";
import { useChatRoute } from "../hooks/useChatRoute";

const APP_TITLE = "Мессенджер";

export function ChatsPage() {
  const { user, logout, reportAccountDisabled } = useAuth();
  const currentUserId = user?.id ?? "";

  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  // Открытый чат живёт в адресе (/c/<id>): работает системная «Назад»,
  // перезагрузка не сбрасывает выбор, ссылкой можно поделиться.
  const [activeId, openChat] = useChatRoute();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  // «18:22» / «вчера» / «пн» в списке чатов пересчитываются в полночь.
  const today = useToday();

  const [people, setPeople] = useState<UserPublic[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const peopleById = useMemo(
    () => new Map((people ?? []).map((u) => [u.id, u.display_name])),
    [people],
  );
  const avatarById = useMemo(
    () => new Map((people ?? []).map((u) => [u.id, u.avatar_url])),
    [people],
  );

  /** chat_id личного чата -> user_id собеседника. */
  const [peerByChat, setPeerByChat] = useState<Map<string, string>>(new Map());
  const peerRequestedRef = useRef<Set<string>>(new Set());

  // --- Список чатов ---------------------------------------------------------
  // Номер запроса: если два reload() летят одновременно (например, два
  // chat.updated подряд за пределами debounce), более ранний ответ может
  // прийти позже и затереть свежий список устаревшим. Применяем только
  // ответ на последний запрос.
  const chatsRequestRef = useRef(0);
  const reloadDebounce = useRef<ReturnType<typeof setTimeout>>();

  const reloadChats = useCallback(async () => {
    const request = ++chatsRequestRef.current;
    try {
      const list = await chatsApi.list();
      if (request !== chatsRequestRef.current) return;
      setChats(list);
      setChatsError(null);
      setChatsLoaded(true);
    } catch (e) {
      if (request !== chatsRequestRef.current) return;
      console.warn("[chats] не удалось загрузить список", e);
      setChatsError(errorMessage(e));
    }
  }, []);

  const scheduleReload = useCallback(() => {
    clearTimeout(reloadDebounce.current);
    reloadDebounce.current = setTimeout(reloadChats, 300);
  }, [reloadChats]);

  // --- Справочник имён ------------------------------------------------------
  const loadPeople = useCallback(async () => {
    try {
      setPeople(await usersApi.list());
      setPeopleError(null);
    } catch (e) {
      console.warn("[users] не удалось загрузить пользователей", e);
      setPeopleError(errorMessage(e));
    }
  }, []);

  // Справочник грузится один раз при входе. Пользователь, который
  // зарегистрировался позже, в нём отсутствует — его имя в чате
  // показывалось бы как «Кто-то». Поэтому, встретив незнакомый id,
  // перезапрашиваем справочник (с debounce и не больше раза на каждый id —
  // удалённого пользователя в списке не будет никогда, не надо зацикливаться).
  const triedUnknownRef = useRef<Set<string>>(new Set());
  const peopleDebounce = useRef<ReturnType<typeof setTimeout>>();
  const requestUsers = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => !triedUnknownRef.current.has(id));
      if (fresh.length === 0) return;
      fresh.forEach((id) => triedUnknownRef.current.add(id));
      clearTimeout(peopleDebounce.current);
      peopleDebounce.current = setTimeout(loadPeople, 500);
    },
    [loadPeople],
  );

  useEffect(() => {
    reloadChats();
    loadPeople();
    return () => {
      clearTimeout(reloadDebounce.current);
      clearTimeout(peopleDebounce.current);
    };
  }, [reloadChats, loadPeople]);

  // --- Собеседники в личных чатах ------------------------------------------
  // GET /chats/ не отдаёт собеседника, а name у личного чата пустой, —
  // поэтому все личные чаты раньше назывались одинаково: «Личный чат».
  // Пока бэкенд не добавит собеседника в ответ (ревью бэкенда, P3), узнаём
  // его из списка участников. Состав личного чата не меняется, поэтому
  // запрашиваем один раз на чат.
  useEffect(() => {
    if (!currentUserId) return;
    const toFetch = chats.filter(
      (c) => c.type === "direct" && !peerRequestedRef.current.has(c.id),
    );
    for (const chat of toFetch) {
      peerRequestedRef.current.add(chat.id);
      chatsApi
        .members(chat.id)
        .then((members) => {
          const peer = members.find((m) => m.user_id !== currentUserId);
          if (!peer) return;
          setPeerByChat((prev) => new Map(prev).set(chat.id, peer.user_id));
        })
        .catch(() => {
          // Попробуем снова при следующем обновлении списка.
          peerRequestedRef.current.delete(chat.id);
        });
    }
  }, [chats, currentUserId]);

  useEffect(() => {
    if (!people) return;
    const unknown = Array.from(peerByChat.values()).filter((id) => !peopleById.has(id));
    if (unknown.length) requestUsers(unknown);
  }, [peerByChat, people, peopleById, requestUsers]);

  const titleOf = useCallback(
    (chat: ChatListItem): string => {
      if (chat.type === "direct") {
        const peerId = peerByChat.get(chat.id);
        const peerName = peerId ? peopleById.get(peerId) : undefined;
        return peerName ?? chat.name ?? "Личный чат";
      }
      return chat.name ?? "Группа без названия";
    },
    [peerByChat, peopleById],
  );

  const renderChatAvatar = useCallback(
    (chat: ChatListItem, size: number) => {
      if (chat.type === "direct") {
        const peerId = peerByChat.get(chat.id);
        return (
          <Avatar
            name={titleOf(chat)}
            seed={peerId ?? chat.id}
            url={peerId ? avatarById.get(peerId) : null}
            size={size}
          />
        );
      }
      return <Avatar name={titleOf(chat)} seed={chat.id} size={size} group={!chat.name} />;
    },
    [peerByChat, avatarById, titleOf],
  );

  // --- Realtime для списка --------------------------------------------------
  // Личный канал: обновляет список чатов (непрочитанные, превью, порядок),
  // даже если событие пришло не из открытого сейчас чата. Debounce на
  // случай, если прилетит несколько chat.updated подряд.
  useMyEventsSocket(!!user, {
    onChatUpdated: scheduleReload,
    // Пока личный канал был разорван, chat.updated могли потеряться.
    onReconnected: scheduleReload,
    onAccountDisabled: reportAccountDisabled,
  });

  // --- Активный чат ---------------------------------------------------------
  // Если доступ к открытому чату пропал (вышли/исключили), после
  // перезагрузки списка его там уже не будет. Держим последний известный
  // объект, чтобы окно успело показать «нет доступа», а не исчезло молча.
  //
  // Раньше объект хранился в ref, записанном прямо во время рендера, — это
  // нарушает правила React (рендер должен быть чистым), и React Compiler
  // такие компоненты пропускает. Здесь — документированный паттерн
  // «информация из прошлых рендеров»: setState во время рендера с условием.
  const found = chats.find((c) => c.id === activeId) ?? null;
  const [lastActive, setLastActive] = useState<ChatListItem | null>(null);
  if (found && found !== lastActive) setLastActive(found);
  const active = found ?? (lastActive?.id === activeId ? lastActive : null);

  // Счётчик непрочитанного во вкладке браузера — видно, даже когда
  // мессенджер открыт в фоне. У открытого чата непрочитанного нет по смыслу.
  const totalUnread = chats.reduce((sum, c) => sum + (c.id === activeId ? 0 : c.unread_count), 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [totalUnread]);

  const handleAccessLost = useCallback(() => {
    scheduleReload();
  }, [scheduleReload]);

  if (!user) return null;

  return (
    <div className={`app-shell${active ? " has-active" : ""}`}>
      <aside className="sidebar" aria-label="Список чатов">
        <div className="sidebar-header">
          <Avatar name={user.display_name} seed={user.id} url={user.avatar_url} size={40} />
          <div className="sidebar-me">
            <h1 className="sidebar-title">Чаты</h1>
            <span className="sidebar-name">{user.display_name}</span>
          </div>
          <div className="sidebar-actions">
            <button
              className="icon-btn"
              title="Новый чат"
              aria-label="Новый чат"
              onClick={() => setDialogOpen(true)}
            >
              <IconCompose />
            </button>
            <button className="icon-btn" title="Выйти" aria-label="Выйти" onClick={logout}>
              <IconLogout />
            </button>
          </div>
        </div>

        {chats.length > 0 && (
          <div className="sidebar-search">
            <label className="search-field">
              <IconSearch size={18} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск"
                aria-label="Поиск по чатам"
              />
            </label>
          </div>
        )}

        {chatsError && (
          <div className="banner banner-danger sidebar-banner" role="alert">
            <span>{chatsError}</span>
            <button className="btn-text" onClick={reloadChats}>
              Повторить
            </button>
          </div>
        )}

        <ChatList
          chats={chats}
          loaded={chatsLoaded}
          activeId={activeId}
          currentUserId={user.id}
          peopleById={peopleById}
          query={query}
          today={today}
          titleOf={titleOf}
          avatarOf={renderChatAvatar}
          onSelect={openChat}
          onNewChat={() => setDialogOpen(true)}
        />
      </aside>

      {active ? (
        <ChatWindow
          key={active.id}
          chat={active}
          title={titleOf(active)}
          avatar={renderChatAvatar(active, 42)}
          currentUserId={user.id}
          peopleById={peopleById}
          avatarById={avatarById}
          onBack={() => openChat(null)}
          onAccessLost={handleAccessLost}
          onUnknownUsers={requestUsers}
        />
      ) : (
        <div className="empty-state">
          <div className="empty-icon empty-icon-lg">
            <IconChat size={36} />
          </div>
          <p className="empty-title">Выберите чат</p>
          <p className="empty-text">Откройте переписку слева или начните новую.</p>
          <button className="btn btn-secondary" onClick={() => setDialogOpen(true)}>
            <IconCompose size={18} />
            Новый чат
          </button>
        </div>
      )}

      {dialogOpen && (
        <NewChatDialog
          currentUserId={user.id}
          people={people}
          peopleError={peopleError}
          onRetryPeople={loadPeople}
          onClose={() => setDialogOpen(false)}
          onCreated={async (chat) => {
            setDialogOpen(false);
            await reloadChats();
            openChat(chat.id);
          }}
        />
      )}
    </div>
  );
}
