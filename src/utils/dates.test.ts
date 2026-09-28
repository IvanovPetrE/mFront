import { describe, expect, it } from "vitest";
import { formatChatTime, formatDayLabel, formatTime, isSameDay, startOfDay, withinMinutes } from "./dates";

// Все даты — в локальном поясе, как их видит пользователь.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const NOW = new Date(2026, 8, 28, 10, 0); // пн, 28 сентября 2026, 10:00

describe("formatDayLabel", () => {
  it("сегодня / вчера / дата / дата с годом", () => {
    expect(formatDayLabel(local(2026, 9, 28, 0, 5), NOW)).toBe("Сегодня");
    expect(formatDayLabel(local(2026, 9, 27, 23, 59), NOW)).toBe("Вчера");
    expect(formatDayLabel(local(2026, 9, 12), NOW)).toBe("12 сентября");
    expect(formatDayLabel(local(2025, 9, 12), NOW)).toBe("12 сентября 2025 г.");
  });

  it("работает от начала дня так же, как от любого момента этого дня (useToday)", () => {
    const midnight = new Date(startOfDay(NOW));
    expect(formatDayLabel(local(2026, 9, 27), midnight)).toBe("Вчера");
  });
});

describe("formatChatTime", () => {
  it("время сегодня, «вчера», день недели, дата, дата с годом", () => {
    expect(formatChatTime(local(2026, 9, 28, 8, 5), NOW)).toBe("08:05");
    expect(formatChatTime(local(2026, 9, 27), NOW)).toBe("вчера");
    expect(formatChatTime(local(2026, 9, 24), NOW)).toBe("чт");
    expect(formatChatTime(local(2026, 9, 12), NOW)).toBe("12 сент.");
    expect(formatChatTime(local(2025, 9, 12), NOW)).toBe("12.09.2025");
  });
});

describe("мелочи", () => {
  it("isSameDay и withinMinutes", () => {
    expect(isSameDay(local(2026, 9, 28, 0, 1), local(2026, 9, 28, 23, 59))).toBe(true);
    expect(isSameDay(local(2026, 9, 27, 23, 59), local(2026, 9, 28, 0, 1))).toBe(false);
    expect(withinMinutes(local(2026, 9, 28, 10, 0), local(2026, 9, 28, 10, 4), 5)).toBe(true);
    expect(withinMinutes(local(2026, 9, 28, 10, 0), local(2026, 9, 28, 10, 5), 5)).toBe(false);
  });

  it("formatTime — часы и минуты с ведущим нулём", () => {
    expect(formatTime(local(2026, 9, 28, 7, 3))).toBe("07:03");
  });
});
