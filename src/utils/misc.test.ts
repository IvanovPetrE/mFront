import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../api/http";
import { plural } from "./plural";
import { uuid } from "./uuid";

describe("plural", () => {
  it("1 / 2–4 / 5–20 / 11–14 / 21 / 22", () => {
    const f = (n: number) => plural(n, "участник", "участника", "участников");
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25, 111].map(f)).toEqual([
      "участник",
      "участника",
      "участников",
      "участников",
      "участников",
      "участников",
      "участник",
      "участника",
      "участников",
      "участников",
    ]);
  });
});

describe("uuid", () => {
  it("формат UUID v4 и уникальность", () => {
    const a = uuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(uuid());
  });
});

describe("errorMessage", () => {
  it("понятный текст по статусу, без сырого ответа сервера", () => {
    expect(errorMessage(new ApiError(0, ""))).toMatch(/Нет связи/);
    expect(errorMessage(new ApiError(403, "Not a member"))).toBe("Нет доступа.");
    expect(errorMessage(new ApiError(503, "<html>"))).toMatch(/Ошибка сервера/);
    expect(errorMessage(new TypeError("x"))).toBe("Что-то пошло не так.");
  });
});
