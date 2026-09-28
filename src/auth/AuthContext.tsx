import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAuthConfig, logout as apiLogout, redirectToLogin, refreshAccessToken, type AuthConfig } from "../api/auth";
import { ApiError, errorMessage } from "../api/http";
import { usersApi } from "../api/users";
import type { User } from "../api/types";
import { tokenStore } from "./tokenStore";

/**
 * - `signing-out` — нажали «Выйти», ждём ответа сервера и редиректа. Без
 *                отдельного статуса обнуление токена переводило в `anonymous`,
 *                и перед уходом на Keycloak на миг мелькал экран входа.
 * - `error`    — не смогли даже выяснить, залогинен ли пользователь (бэкенд
 *                недоступен, 5xx). Раньше в этом случае исключение улетало
 *                из async-IIFE в никуда, и экран навсегда оставался на
 *                «Загрузка…».
 * - `disabled` — сессия в Keycloak есть, но бэкенд не пускает: запись
 *                пользователя деактивирована (403 на /users/me, 4403 на
 *                /ws/me). Показывать «Войти» здесь бессмысленно — вход
 *                пройдёт и снова упрётся в 403, получится петля.
 */
type Status = "loading" | "authenticated" | "anonymous" | "error" | "disabled" | "signing-out";

interface AuthContextValue {
  status: Status;
  user: User | null;
  /** Текст для экрана `error`. */
  error: string | null;
  login: () => void;
  logout: () => void;
  retry: () => void;
  /** Вызывается, когда бэкенд сообщил, что аккаунт отключён (например, WS 4403). */
  reportAccountDisabled: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Пауза перед повтором фонового обновления токена после сетевого сбоя. */
const REFRESH_RETRY_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<AuthConfig | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  // Номер текущей попытки bootstrap: ответ от устаревшей попытки (StrictMode,
  // повторное нажатие «Повторить») не должен перетирать состояние новой.
  const bootGeneration = useRef(0);

  useEffect(() => {
    function scheduleRefresh(ms: number) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        // Через tokenStore, а не doRefresh напрямую: так фоновое обновление
        // склеивается с одновременным 401→refresh из http.ts в один запрос.
        tokenStore.refresh().catch((e) => {
          // Сеть моргнула или бэкенд отдал 5xx. Сессия при этом, скорее
          // всего, жива — просто пробуем ещё раз чуть позже. Раньше таймер
          // в этом случае больше не заводился: токен тихо истекал, а в
          // консоли висел unhandled rejection.
          console.warn("[auth] фоновое обновление токена не удалось, повтор", e);
          scheduleRefresh(REFRESH_RETRY_MS);
        });
      }, ms);
    }

    async function doRefresh(): Promise<string | null> {
      if (!configRef.current) return null;
      const result = await refreshAccessToken(configRef.current);
      if (!result) {
        clearTimeout(refreshTimer.current);
        tokenStore.set(null);
        return null;
      }
      tokenStore.set(result.access_token);
      // Обновляем токен чуть заранее, а не ровно в момент истечения.
      scheduleRefresh(Math.max(result.expires_in - 30, 10) * 1000);
      return result.access_token;
    }

    tokenStore.registerRefresh(doRefresh);
    return () => clearTimeout(refreshTimer.current);
  }, []);

  const bootstrap = useCallback(async () => {
    const generation = ++bootGeneration.current;
    const isStale = () => generation !== bootGeneration.current;

    setStatus("loading");
    setError(null);
    try {
      if (!configRef.current) {
        const config = await getAuthConfig();
        if (isStale()) return;
        configRef.current = config;
      }

      const token = await tokenStore.refresh();
      if (isStale()) return;
      if (!token) {
        setStatus("anonymous");
        return;
      }

      const me = await usersApi.me();
      if (isStale()) return;
      setUser(me);
      setStatus("authenticated");
    } catch (e) {
      if (isStale()) return;
      if (e instanceof ApiError && e.status === 403) {
        clearTimeout(refreshTimer.current);
        setStatus("disabled");
        return;
      }
      console.error("[auth] bootstrap не удался", e);
      setError(errorMessage(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    bootstrap();
    return () => {
      // Инвалидируем текущую попытку — её поздний ответ будет проигнорирован.
      bootGeneration.current++;
    };
  }, [bootstrap]);

  // Сессия могла умереть где угодно: неудачный silent-refresh по таймеру,
  // 401 -> refresh при обычном REST-запросе (api/http.ts), 4401 у
  // WebSocket. Всегда в итоге зовётся tokenStore.set(null) — подписываемся
  // на это здесь, а не дублируем "переключить на экран логина" в каждом
  // месте, где токен может обнулиться.
  useEffect(() => {
    return tokenStore.subscribe((token) => {
      if (token === null) {
        setStatus((prev) => (prev === "authenticated" ? "anonymous" : prev));
        setUser(null);
      }
    });
  }, []);

  const login = useCallback(() => {
    if (configRef.current) {
      // Абсолютный URL, а не просто pathname: OAuth-редирект — это полная
      // навигация браузера, а не fetch через прокси. Бэкенд вернёт нас на
      // PUBLIC_BASE_URL (порт 8000), и там относительный "/chat" превратится
      // в http://localhost:8000/chat. Абсолютный next такого не допустит —
      // см. комментарий у redirectToLogin в api/auth.ts.
      redirectToLogin(configRef.current, window.location.href);
    } else {
      // Конфиг так и не загрузился — сначала пробуем его получить.
      bootstrap();
    }
  }, [bootstrap]);

  const logout = useCallback(() => {
    clearTimeout(refreshTimer.current);
    // Сначала статус: подписчик на tokenStore меняет только
    // "authenticated" → "anonymous", "signing-out" он не тронет.
    setStatus("signing-out");
    if (configRef.current) {
      apiLogout(configRef.current);
    } else {
      tokenStore.set(null);
      window.location.href = "/";
    }
  }, []);

  const reportAccountDisabled = useCallback(() => {
    clearTimeout(refreshTimer.current);
    // Сначала статус, потом обнуление токена: подписчик выше меняет только
    // "authenticated" → "anonymous", и "disabled" он не перетрёт.
    setStatus("disabled");
    tokenStore.set(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, user, error, login, logout, retry: bootstrap, reportAccountDisabled }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
