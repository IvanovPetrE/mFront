import { tokenStore } from "../auth/tokenStore";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Ошибка запроса к API.
 *
 * `status === 0` — ответа не было вовсе (нет сети, бэкенд лежит, CORS):
 * `fetch` в этом случае бросает голый `TypeError("Failed to fetch")`, и без
 * отдельного статуса такую ошибку не отличить от бага в нашем же коде.
 *
 * `detail` — человекочитаемая часть ответа FastAPI. Сервер отдаёт ошибки
 * как `{"detail": "..."}`, а при ошибках валидации (422) — как
 * `{"detail": [{"msg": "...", ...}]}`. Раньше в `message` попадал весь
 * JSON целиком, показывать такое пользователю нельзя.
 */
export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function extractDetail(body: string): string {
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) {
        return detail
          .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
          .filter(Boolean)
          .join("; ");
      }
    }
  } catch {
    // Не JSON (например, HTML-страница ошибки от прокси) — наружу не отдаём.
  }
  return "";
}

/**
 * Текст ошибки для показа пользователю. Никогда не возвращает сырое
 * тело ответа или стек: только понятные фразы, детали — в консоль.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Нет связи с сервером. Проверьте подключение.";
    if (e.status === 401) return "Сессия истекла. Войдите снова.";
    // detail от бэкенда — на английском и для разработчика ("Not a member",
    // "String should have at most 8000 characters"), поэтому в интерфейс
    // идут свои формулировки, а detail остаётся в консоли и в e.detail.
    if (e.status === 403) return "Нет доступа.";
    if (e.status === 404) return "Не найдено.";
    if (e.status === 422) return "Сервер отклонил данные как некорректные.";
    if (e.status === 429) return "Слишком много запросов. Подождите немного.";
    if (e.status >= 500) return "Ошибка сервера. Попробуйте позже.";
    return `Ошибка ${e.status}.`;
  }
  return "Что-то пошло не так.";
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  } catch (e) {
    // Прерванный через AbortController запрос — это не "нет сети",
    // его надо пробросить как есть, чтобы вызывающий код его узнал.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "");
  }
}

/**
 * Обёртка над fetch для REST-эндпоинтов чатов/сообщений/пользователей.
 * На 401 один раз пробует обновить access-токен через /auth/refresh и
 * повторяет запрос — так пользователя не выбрасывает из чата, если он
 * просто долго сидел без действий и токен успел истечь (TTL ~5 минут).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init);

  if (res.status === 401) {
    const newToken = await tokenStore.refresh();
    if (newToken) {
      res = await rawRequest(path, init);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new ApiError(res.status, extractDetail(body));
    console.warn(`[api] ${init.method ?? "GET"} ${path} → ${res.status}`, body);
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
