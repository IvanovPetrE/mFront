import { useEffect, useRef, useState } from "react";
import { tokenStore } from "../auth/tokenStore";

// Коды закрытия, которые шлёт бэкенд (app/routers/ws.py).
export const CLOSE_UNAUTHORIZED = 4401; // токен истёк или невалиден
export const CLOSE_FORBIDDEN = 4403; // аккаунт отключён / нет доступа к чату
export const CLOSE_NOT_FOUND = 4404; // чата не существует

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15_000;
// Прокси и балансировщики (nginx по умолчанию — 60 с) тихо рвут
// соединения, по которым ничего не идёт. Пинг раз в 25 с держит их живыми.
const PING_INTERVAL_MS = 25_000;
// Если сервер уже показал, что отвечает на ping, но замолчал дольше этого,
// соединение считаем мёртвым (типично для телефона, ушедшего в сон):
// сокет формально OPEN, но данные не ходят, и без проверки мы бы этого
// не заметили до следующей попытки что-то отправить.
const DEAD_AFTER_MS = 60_000;

export function wsBaseUrl(): string {
  const explicit = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (explicit) return explicit;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export interface SocketOptions {
  /** Любое пришедшее событие, уже распарсенное из JSON. `pong` сюда не попадает. */
  onEvent: (msg: { event: string; data?: unknown }) => void;
  /** Соединение открыто. `isReconnect` — true, если до этого уже было открытие и разрыв. */
  onOpen?: (isReconnect: boolean) => void;
  /**
   * Сервер закрыл соединение кодом, после которого переподключаться
   * бессмысленно (4403, 4404). Раньше хуки обрабатывали только 4401 и на
   * остальные коды долбили сервер раз в 15 секунд бесконечно.
   */
  onFatalClose?: (code: number) => void;
  /**
   * Вызывается при уходе (размонтирование, смена `path`) ПЕРЕД закрытием
   * сокета, пока через него ещё можно что-то отправить. Нужен для «прощальных»
   * событий вроде `typing: false`: из cleanup дочернего компонента их уже не
   * отправить — React выполняет cleanup родителя раньше, чем детей, и к
   * этому моменту сокет закрыт.
   */
  beforeClose?: (send: (event: object) => boolean) => void;
}

/**
 * Одно WebSocket-соединение с автоматическим переподключением.
 *
 * Общая часть двух бывших хуков (`useChatSocket` и `useMyEventsSocket`),
 * которые до этого были скопированы друг с друга почти построчно.
 *
 * `path` — путь без токена, например `/ws/chat/<id>`. `null` — не подключаться.
 */
export function useReconnectingSocket(path: string | null, options: SocketOptions) {
  const [connected, setConnected] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let retryDelay = RETRY_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let everOpened = false;

    function scheduleReconnect() {
      if (cancelled) return;
      // Jitter: если бэкенд перезапустился, все клиенты разом получили
      // разрыв. Без случайной добавки они бы и возвращались синхронно —
      // волнами, каждый раз в одну и ту же секунду.
      const delay = retryDelay / 2 + Math.random() * (retryDelay / 2);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    }

    async function connect() {
      retryTimer = undefined;
      let token: string | null;
      try {
        token = tokenStore.get() ?? (await tokenStore.refresh());
      } catch {
        // Сетевой сбой при обновлении токена. Раньше исключение улетало из
        // async-функции, и попытки переподключения прекращались навсегда.
        scheduleReconnect();
        return;
      }
      // Нет токена — сессии нет, AuthContext уже показывает экран входа.
      if (cancelled || !token) return;

      const ws = new WebSocket(`${wsBaseUrl()}${path}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      let lastSeenAt = Date.now();
      let serverAnswersPing = false;

      ws.onopen = () => {
        if (cancelled) return;
        retryDelay = RETRY_MIN_MS;
        setConnected(true);
        optionsRef.current.onOpen?.(everOpened);
        everOpened = true;

        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (serverAnswersPing && Date.now() - lastSeenAt > DEAD_AFTER_MS) {
            ws.close(); // onclose сам запланирует переподключение
            return;
          }
          ws.send(JSON.stringify({ event: "ping" }));
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (evt) => {
        if (cancelled) return;
        lastSeenAt = Date.now();
        let msg: { event: string; data?: unknown };
        try {
          msg = JSON.parse(evt.data);
        } catch {
          console.warn("[ws] кадр не является JSON, пропускаю", evt.data);
          return;
        }
        if (!msg || typeof msg.event !== "string") return;
        if (msg.event === "pong") {
          serverAnswersPing = true;
          return;
        }
        optionsRef.current.onEvent(msg);
      };

      ws.onclose = async (evt) => {
        clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
        setConnected(false);

        if (evt.code === CLOSE_FORBIDDEN || evt.code === CLOSE_NOT_FOUND) {
          optionsRef.current.onFatalClose?.(evt.code);
          return;
        }
        if (evt.code === CLOSE_UNAUTHORIZED) {
          try {
            const fresh = await tokenStore.refresh();
            if (!fresh) return; // сессия умерла — переподключаться не с чем
          } catch {
            // сеть — просто попробуем позже
          }
        }
        scheduleReconnect();
      };
    }

    // Сеть вернулась — не ждём окончания backoff (до 15 с), а подключаемся сразу.
    function handleOnline() {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryDelay = RETRY_MIN_MS;
        connect();
      }
    }
    window.addEventListener("online", handleOnline);

    connect();

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        optionsRef.current.beforeClose?.((event) => {
          ws.send(JSON.stringify(event));
          return true;
        });
      }
      ws?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [path]);

  function send(event: object): boolean {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
      return true;
    }
    return false;
  }

  return { connected, send };
}
