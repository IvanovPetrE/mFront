import { API_BASE, ApiError } from "./http";
import { getCookie } from "../utils/cookies";
import { tokenStore } from "../auth/tokenStore";

export interface AuthConfig {
  flow: string;
  login_url: string;
  csrf_cookie: string;
  csrf_header: string;
  auth_disabled: boolean;
  password_grant_enabled: boolean;
  issuer: string;
  client_id: string;
}

export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** fetch, у которого сетевой сбой — это ApiError(0), а не голый TypeError. */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
  } catch {
    throw new ApiError(0, "");
  }
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const res = await authFetch("/auth/config");
  if (!res.ok) throw new ApiError(res.status, "Не удалось получить /auth/config");
  return res.json();
}

/** Полный редирект браузера — это серверный OIDC-флоу, не fetch. */
export function redirectToLogin(config: AuthConfig, next: string) {
  const url = `${API_BASE}${config.login_url}?next=${encodeURIComponent(next)}`;
  window.location.href = url;
}

/**
 * Обновляет access-токен по refresh-cookie. Возвращает null, если сессии
 * нет (пользователь не залогинен / SSO-сессия истекла) — это штатный
 * случай при первой загрузке страницы, не ошибка.
 */
export async function refreshAccessToken(
  config: AuthConfig,
): Promise<AccessTokenResponse | null> {
  const csrf = getCookie(config.csrf_cookie);
  const headers: HeadersInit = {};
  if (csrf) headers[config.csrf_header] = csrf;

  const res = await authFetch("/auth/refresh", { method: "POST", headers });
  // 401 — refresh-cookie истекла/отозвана. 403 — её вообще нет (анонимный
  // визит): _require_csrf в auth.py проверяет CSRF раньше, чем наличие
  // самой cookie, и валится с 403 ещё до этой проверки. Для фронта оба
  // случая означают одно и то же: пользователь не залогинен.
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new ApiError(res.status, "Не удалось обновить токен");
  return res.json();
}

export async function logout(config: AuthConfig): Promise<void> {
  const csrf = getCookie(config.csrf_cookie);
  const headers: HeadersInit = {};
  if (csrf) headers[config.csrf_header] = csrf;

  let endSessionUrl: string | undefined;
  try {
    const res = await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers,
    });
    const body = await res.json().catch(() => null);
    endSessionUrl = body?.end_session_url;
  } catch {
    // Сеть отвалилась, бэкенд недоступен — что угодно. Нажатие "выйти"
    // обязано сработать локально в любом случае: нельзя, чтобы человек
    // считал себя вышедшим из аккаунта, а токен в памяти вкладки остался.
  }

  // Чистим локально независимо от того, ответил ли сервер: не ждём
  // редиректа/перезагрузки страницы, чтобы состояние протухло само.
  tokenStore.set(null);

  // Уходим и с домена Keycloak, иначе повторный вход пройдёт без пароля.
  // Если сервер не ответил — end_session_url не построить (нужен точный
  // адрес Keycloak с client_id), поэтому просто возвращаемся на "/":
  // AuthProvider увидит отсутствие сессии и покажет экран логина.
  window.location.href = endSessionUrl ?? "/";
}
