import { useEffect, useId, useRef, useState } from "react";
import { chatsApi } from "../api/chats";
import { ApiError, errorMessage } from "../api/http";
import type { ChatOut, UserPublic } from "../api/types";
import { plural } from "../utils/plural";
import { Avatar } from "./Avatar";
import { IconClose, IconSearch } from "./icons";

export function NewChatDialog({
  currentUserId,
  people,
  peopleError,
  onRetryPeople,
  onClose,
  onCreated,
}: {
  currentUserId: string;
  /** null — ещё грузится. Список общий с остальным приложением, отдельно не запрашивается. */
  people: UserPublic[] | null;
  peopleError: string | null;
  onRetryPeople: () => void;
  onClose: () => void;
  onCreated: (chat: ChatOut) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // onClose — через ref. Родитель передаёт новую функцию на каждом своём
  // рендере (а он перерисовывается на каждое chat.updated), и эффект ниже с
  // [onClose] в зависимостях перезапускался бы каждый раз — снова переводя
  // фокус на окно и выдёргивая его из поля, где человек печатает.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    // Фокус внутрь окна при открытии и обратно на кнопку «Новый чат» при закрытии.
    dialogRef.current?.focus();
    // Страница под модалкой не должна прокручиваться (особенно на телефоне).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const others = (people ?? []).filter((u) => u.id !== currentUserId);
  const q = search.trim().toLowerCase();
  const visible = q ? others.filter((u) => u.display_name.toLowerCase().includes(q)) : others;
  const selectedPeople = others.filter((u) => selected.has(u.id));
  const isGroup = selected.size > 1;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chat = await chatsApi.create({
        type: isGroup ? "group" : "direct",
        name: isGroup ? groupName.trim() || undefined : undefined,
        member_ids: Array.from(selected),
      });
      onCreated(chat);
    } catch (e) {
      // Прямой чат, который уже существует, сервер сам находит и возвращает
      // (см. direct_key в models.py) — сюда долетают только настоящие
      // ошибки: сеть, 422, 403.
      setError(e instanceof ApiError ? errorMessage(e) : "Не удалось создать чат.");
    } finally {
      setBusy(false);
    }
  }

  let hint = "Выберите одного человека для личного чата или нескольких — для группы.";
  if (selected.size === 1) hint = `Личный чат: ${selectedPeople[0]?.display_name ?? ""}`;
  if (isGroup) hint = `Группа: вы и ещё ${selected.size} ${plural(selected.size, "участник", "участника", "участников")}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>Новый чат</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div className="modal-body">
          {others.length > 5 && (
            <label className="search-field modal-search">
              <IconSearch size={18} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти человека"
                aria-label="Найти человека"
              />
            </label>
          )}

          <p className="modal-hint" aria-live="polite">
            {hint}
          </p>

          {isGroup && (
            <input
              className="field"
              placeholder="Название группы (необязательно)"
              value={groupName}
              maxLength={100}
              onChange={(e) => setGroupName(e.target.value)}
              aria-label="Название группы"
            />
          )}

          {people === null && !peopleError && (
            <div className="list-placeholder">
              <span className="spinner" aria-hidden="true" />
              Загрузка людей…
            </div>
          )}
          {peopleError && (
            <div className="banner banner-danger">
              <span>{peopleError}</span>
              <button className="btn-text" onClick={onRetryPeople}>
                Повторить
              </button>
            </div>
          )}
          {people !== null && others.length === 0 && !peopleError && (
            <div className="list-placeholder">Больше пока никого нет.</div>
          )}
          {others.length > 0 && visible.length === 0 && (
            <div className="list-placeholder">Никого не нашлось</div>
          )}

          <div className="people-list">
            {visible.map((u) => (
              <label key={u.id} className={`person-row${selected.has(u.id) ? " selected" : ""}`}>
                <Avatar name={u.display_name} seed={u.id} url={u.avatar_url} size={40} />
                <span className="person-name">{u.display_name}</span>
                <input
                  type="checkbox"
                  className="check"
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
              </label>
            ))}
          </div>

          {error && (
            <div className="banner banner-danger" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={create}>
            {busy ? "Создаём…" : isGroup ? "Создать группу" : "Начать чат"}
          </button>
        </div>
      </div>
    </div>
  );
}
