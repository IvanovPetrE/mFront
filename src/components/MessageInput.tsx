import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "../api/http";
import { MAX_MESSAGE_LENGTH } from "../api/types";
import { uuid } from "../utils/uuid";
import { IconRetry, IconSend } from "./icons";

// Через сколько после последнего нажатия считаем, что человек перестал печатать.
const TYPING_IDLE_MS = 2000;
// Счётчик символов показываем только ближе к лимиту — не отвлекать зря.
const COUNTER_FROM = MAX_MESSAGE_LENGTH - 1000;
// Поле растёт вместе с текстом до этой высоты, дальше — прокрутка внутри.
const MAX_FIELD_HEIGHT_PX = 160;

// На сенсорных экранах Enter — это перенос строки (как в нативных
// мессенджерах), а отправка — кнопкой. На ПК Enter отправляет, Shift+Enter
// переносит строку.
const isTouchDevice = () =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

export function MessageInput({
  onSend,
  onTyping,
  disabled = false,
}: {
  /** Должен бросить исключение, если отправка не удалась, — тогда текст останется в поле. */
  onSend: (text: string, clientId: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const isTypingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // client_id живёт вместе с черновиком, а не генерируется на каждое
  // нажатие «Отправить». Если запрос дошёл до сервера, а ответ потерялся
  // (таймаут, сеть моргнула), повторная отправка того же текста придёт с
  // тем же client_id, и бэкенд вернёт уже созданное сообщение, а не дубль.
  const draftClientId = useRef<string | null>(null);

  // При уходе из чата снимаем таймер. «Перестал печатать» отсюда не шлём:
  // cleanup родителя (ChatWindow) выполняется раньше нашего, сокет к этому
  // моменту уже закрыт. Это делает сам сокет-хук перед закрытием
  // (`beforeClose` в useChatSocket).
  useEffect(() => () => clearTimeout(typingTimeout.current), []);

  // Автоподъём: сбрасываем высоту и берём реальную высоту содержимого.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT_PX)}px`;
  }, [value]);

  function stopTyping() {
    clearTimeout(typingTimeout.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping(false);
    }
  }

  function handleChange(text: string) {
    setValue(text);
    setError(null);
    draftClientId.current = null; // текст изменился — это уже другое сообщение
    if (text) {
      isTypingRef.current = true;
      onTyping(true); // useChatSocket сам ограничивает частоту отправки
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(stopTyping, TYPING_IDLE_MS);
    } else {
      stopTyping();
    }
  }

  async function submit() {
    // Раньше поле очищалось сразу, ещё до ответа сервера, а ошибка отправки
    // нигде не ловилась: нет сети — и написанный текст просто исчезал.
    if (sending || disabled) return;
    const raw = value;
    const text = raw.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов.`);
      return;
    }

    const clientId = (draftClientId.current ??= uuid());
    stopTyping();
    setSending(true);
    setError(null);
    try {
      await onSend(text, clientId);
      // Пока запрос летел, человек мог начать печатать следующее —
      // затираем поле, только если в нём всё ещё отправленный текст.
      setValue((current) => (current === raw ? "" : current));
      draftClientId.current = null;
    } catch (e) {
      setError(`Не отправлено: ${errorMessage(e)}`);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const canSend = !disabled && !sending && value.trim().length > 0;

  return (
    <div className="composer">
      <div className="composer-inner">
        {error && (
          <div className="composer-error" role="alert">
            <span>{error}</span>
            <button className="btn-text" onClick={submit} disabled={sending}>
              <IconRetry size={16} />
              Повторить
            </button>
          </div>
        )}
        <div className="composer-row">
          <div className={`composer-field${disabled ? " disabled" : ""}`}>
            <textarea
              ref={inputRef}
              rows={1}
              value={value}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={disabled}
              aria-label="Текст сообщения"
              placeholder={disabled ? "Отправка недоступна" : "Сообщение"}
              enterKeyHint={isTouchDevice() ? "enter" : "send"}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                // isComposing: при вводе через IME (китайский, японский, иногда
                // голосовой ввод) Enter подтверждает выбор слова, а не отправку.
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                if (e.shiftKey || isTouchDevice()) return; // перенос строки
                e.preventDefault();
                submit();
              }}
            />
          </div>
          <button
            className="send-btn"
            onClick={submit}
            disabled={!canSend}
            aria-label={sending ? "Отправляется…" : "Отправить"}
            title="Отправить"
          >
            {sending ? <span className="spinner spinner-sm" aria-hidden="true" /> : <IconSend size={20} />}
          </button>
        </div>
        {value.length >= COUNTER_FROM && (
          <div className="composer-counter" aria-live="polite">
            {value.length} / {MAX_MESSAGE_LENGTH}
          </div>
        )}
      </div>
    </div>
  );
}
