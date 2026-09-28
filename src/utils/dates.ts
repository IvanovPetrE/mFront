function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** true, если два ISO-времени приходятся на один календарный день (в поясе пользователя). */
export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** «Сегодня», «Вчера», «12 сентября» или «12 сентября 2025» для прошлых лет. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/**
 * Время последнего сообщения в списке чатов — как в привычных мессенджерах:
 * сегодня — «18:22», вчера — «вчера», на этой неделе — «пн», в этом году —
 * «12 сент.», раньше — «12.09.2025».
 */
export function formatChatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return formatTime(iso);
  if (diffDays === 1) return "вчера";
  if (diffDays < 7) return d.toLocaleDateString("ru-RU", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** true, если между двумя моментами меньше `minutes` минут. */
export function withinMinutes(a: string, b: string, minutes: number): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < minutes * 60_000;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
