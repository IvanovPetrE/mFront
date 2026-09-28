import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Нативный <dialog> + showModal() даёт из коробки то, что раньше
  // приходилось писать руками и что работало не полностью: фокус не уходит
  // из окна по Tab, страница под окном недоступна (inert), Escape вызывает
  // событие cancel, а само окно рисуется в top layer — поверх всего без
  // всяких z-index (раньше из-за них модалка на телефоне оказывалась под
  // сайдбаром).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog.showModal();
    // Фокус на само окно, а не на первое поле: на телефоне фокус в поле
    // сразу открыл бы клавиатуру поверх шторки.
    dialog.focus();
    return () => {
      if (dialog.open) dialog.close();
      previouslyFocused?.focus?.();
    };
  }, []);

  // Закрытие кликом по подложке: и нажатие, и отпускание должны прийтись
  // на подложку. Иначе окно закрывалось, если нажать мышь внутри (например,
  // выделяя текст в поле) и отпустить снаружи — click приходит на общего предка.
  const pressedOnBackdrop = useRef(false);
  function onBackdrop(e: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>): boolean {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

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
    <dialog
      className="modal"
      ref={dialogRef}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(e) => {
        // Escape: закрываем через родителя, чтобы состояние React и окно
        // не разошлись. Родитель размонтирует нас, cleanup вызовет close().
        e.preventDefault();
        onClose();
      }}
      // Страховка: если браузер закрыл окно сам (например, повторный Escape
      // Chrome не даёт отменить), сообщаем родителю.
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = onBackdrop(e);
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && onBackdrop(e)) onClose();
        pressedOnBackdrop.current = false;
      }}
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
    </dialog>
  );
}
