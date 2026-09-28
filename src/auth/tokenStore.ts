// Access-токен намеренно нигде не попадает в localStorage/sessionStorage —
// только в памяти вкладки, как задумано BFF-схемой на бэкенде (см. auth.py).
// При перезагрузке страницы токен теряется и восстанавливается через
// POST /auth/refresh по HttpOnly refresh-cookie.

type RefreshFn = () => Promise<string | null>;

let accessToken: string | null = null;
let refreshFn: RefreshFn | null = null;
const listeners = new Set<(token: string | null) => void>();

// Если 401 прилетает одновременно на несколько запросов (например,
// список чатов и список пользователей грузятся параллельно), каждый
// вызовет tokenStore.refresh(). Без дедупликации это будет несколько
// параллельных POST /auth/refresh с одним и тем же refresh-токеном —
// не критично для корректности (сервер идемпотентен), но лишняя нагрузка
// и гонка, если возвращаются в разном порядке. Здесь все конкурентные
// вызовы ждут один и тот же in-flight Promise.
let inFlightRefresh: Promise<string | null> | null = null;

/**
 * Дедуп выше работает только внутри одной вкладки. Если открыто несколько
 * вкладок, каждая обновляет токен по своему таймеру, и все шлют один и тот
 * же refresh-cookie. Пока ротация refresh-токенов в Keycloak выключена
 * (revokeRefreshToken=false), это просто лишние запросы. Но если её
 * включат (см. ревью бэкенда, P1-13), первая вкладка получит новый cookie,
 * а вторая придёт со старым, уже отозванным, — и её разлогинит.
 *
 * Web Locks API выстраивает вкладки в очередь: пока одна обновляет токен,
 * остальные ждут и затем идут уже с новым cookie (cookie у вкладок общие).
 * API есть только в защищённом контексте (https/localhost) — без него
 * работаем как раньше.
 */
function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("messenger-auth-refresh", fn);
  }
  return fn();
}

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null) {
    accessToken = token;
    listeners.forEach((l) => l(token));
  },
  subscribe(listener: (token: string | null) => void): () => void {
    listeners.add(listener);
    // Фигурные скобки обязательны: `() => listeners.delete(listener)` вернула
    // бы boolean, а функция очистки эффекта в React обязана ничего не
    // возвращать — с настоящими @types/react на этом падал `tsc -b` в сборке.
    return () => {
      listeners.delete(listener);
    };
  },
  // AuthContext регистрирует реальную реализацию refresh при монтировании;
  // http.ts дёргает её при 401, не зная деталей CSRF/cookie-имён.
  registerRefresh(fn: RefreshFn) {
    refreshFn = fn;
  },
  async refresh(): Promise<string | null> {
    if (!refreshFn) return null;
    if (inFlightRefresh) return inFlightRefresh;
    const fn = refreshFn;
    inFlightRefresh = withCrossTabLock(fn).finally(() => {
      inFlightRefresh = null;
    });
    return inFlightRefresh;
  },
};
