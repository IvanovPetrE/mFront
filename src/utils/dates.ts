// Форматтеры создаются один раз на модуль. `date.toLocaleTimeString("ru-RU", …)`
// каждый раз заново строит Intl.DateTimeFormat — это ~60 мкс на вызов против
// ~2 мкс у готового форматтера (замер в ревью от 28.09). Лента зовёт
// форматирование на каждый пузырь, так что разница — в 30 раз на каждую
// перерисовку.
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DAY_MONTH_LONG = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const DAY_MONTH_LONG_YEAR = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
const DAY_MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const NUMERIC_DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

const DAY_MS = 86_400_000;

/** Начало календарного дня (в поясе пользователя), мс. */
export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Сколько календарных дней между `d` и `now` (0 — тот же день). Math.round сглаживает переход на летнее время. */
function daysAgo(d: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
}

/** true, если два ISO-времени приходятся на один календарный день (в поясе пользователя). */
export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** «Сегодня», «Вчера», «12 сентября» или «12 сентября 2025» для прошлых лет. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = daysAgo(d, now);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return (d.getFullYear() === now.getFullYear() ? DAY_MONTH_LONG : DAY_MONTH_LONG_YEAR).format(d);
}

/**
 * Время последнего сообщения в списке чатов — как в привычных мессенджерах:
 * сегодня — «18:22», вчера — «вчера», на этой неделе — «пн», в этом году —
 * «12 сент.», раньше — «12.09.2025».
 */
export function formatChatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = daysAgo(d, now);
  if (diff <= 0) return TIME.format(d);
  if (diff === 1) return "вчера";
  if (diff < 7) return WEEKDAY_SHORT.format(d);
  if (d.getFullYear() === now.getFullYear()) return DAY_MONTH_SHORT.format(d);
  return NUMERIC_DATE.format(d);
}

/** true, если между двумя моментами меньше `minutes` минут. */
export function withinMinutes(a: string, b: string, minutes: number): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < minutes * 60_000;
}

/** «18:22». */
export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** «28.09.2026, 18:22:05» — для подсказки при наведении на время. */
export function formatFullDate(iso: string): string {
  return FULL.format(new Date(iso));
}
