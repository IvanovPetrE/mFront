// Сценарии из ревью фронтенда от 28.09.2026 (таблица «Что проверено в
// браузере»). Каждый тест раньше падал — теперь это защита от регрессий.

import { expect, test, type Page } from "@playwright/test";
import { ANNA, count, makeMessage, mockBackend } from "./mockBackend";

async function openApp(page: Page) {
  const backend = await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Анна Смирнова/ })).toBeVisible();
  return backend;
}

async function openChat(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).click();
  await expect(page.locator(".msg-row").first()).toBeVisible();
}

const isStatus = (id: string) => (r: string) => r === `POST /messages/${id}/status?status=read`;
const isAnyStatus = (r: string) => r.includes("/status?status=read");

test.describe("прочтение", () => {
  test("чат с 20 непрочитанными: одно прочтение и один статус вместо 21 запроса", async ({ page }) => {
    const backend = await openApp(page);
    await openChat(page, /Анна Смирнова/);

    await expect.poll(() => count(backend.requests, (r) => r.startsWith("POST /chats/c-direct/read"))).toBe(1);
    await expect.poll(() => count(backend.requests, isStatus("c-direct-m60"))).toBe(1);
    await page.waitForTimeout(300);
    expect(count(backend.requests, isAnyStatus)).toBe(1);
  });

  test("новое сообщение не отмечается, пока человек читает историю выше", async ({ page }) => {
    const backend = await openApp(page);
    await openChat(page, /Анна Смирнова/);
    await expect.poll(() => count(backend.requests, isStatus("c-direct-m60"))).toBe(1);

    await page.locator(".message-list").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(200);
    backend.push("/ws/chat/c-direct", {
      event: "message.created",
      data: makeMessage("c-direct", 61, ANNA.id, "delivered", "Новое, пока я читаю историю"),
    });

    const newMessages = page.getByRole("button", { name: /Новые сообщения/ });
    await expect(newMessages).toBeVisible();
    await page.waitForTimeout(400);
    expect(count(backend.requests, isStatus("c-direct-m61"))).toBe(0);

    await newMessages.click();
    await expect.poll(() => count(backend.requests, isStatus("c-direct-m61"))).toBe(1);
  });

  test("пока окно не в фокусе, прочтение не уходит; вернулся — уходит", async ({ page }) => {
    const backend = await openApp(page);
    await openChat(page, /Анна Смирнова/);
    await expect.poll(() => count(backend.requests, isStatus("c-direct-m60"))).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    backend.push("/ws/chat/c-direct", {
      event: "message.created",
      data: makeMessage("c-direct", 61, ANNA.id, "delivered", "Пришло, пока я в другом окне"),
    });
    await expect(page.getByText("Пришло, пока я в другом окне")).toBeVisible();
    await page.waitForTimeout(400);
    expect(count(backend.requests, isStatus("c-direct-m61"))).toBe(0);

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => count(backend.requests, isStatus("c-direct-m61"))).toBe(1);
  });
});

test("уход из чата посреди набора отправляет typing:false до закрытия сокета", async ({ page }) => {
  const backend = await openApp(page);
  await openChat(page, /Анна Смирнова/);

  await page.getByLabel("Текст сообщения").pressSequentially("привет");
  await expect.poll(() => backend.wsLog.some((l) => l.includes('"is_typing":true'))).toBe(true);

  await page.getByRole("button", { name: /Команда/ }).click();
  await expect.poll(() => backend.wsLog.includes("CLOSE /ws/chat/c-direct")).toBe(true);

  const log = backend.wsLog.filter((l) => l.includes("/ws/chat/c-direct"));
  const stop = log.findIndex((l) => l.includes('"is_typing":false'));
  expect(stop).toBeGreaterThan(-1);
  // lastIndexOf: в dev StrictMode открывает и сразу закрывает лишний сокет.
  expect(stop).toBeLessThan(log.lastIndexOf("CLOSE /ws/chat/c-direct"));
});

test("неудачная отправка оставляет текст, повтор идёт с тем же client_id", async ({ page }) => {
  const backend = await openApp(page);
  await openChat(page, /Анна Смирнова/);

  backend.failNextSend("network");
  const field = page.getByLabel("Текст сообщения");
  await field.fill("Проверка связи");
  await field.press("Enter");

  await expect(page.getByRole("alert")).toContainText("Не отправлено");
  await expect(field).toHaveValue("Проверка связи");

  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.locator(".bubble-text", { hasText: "Проверка связи" })).toBeVisible();
  await expect(field).toHaveValue("");
  expect(backend.sent).toHaveLength(2);
  expect(backend.sent[1]!.client_id).toBe(backend.sent[0]!.client_id);
});

test.describe("окно «Новый чат»", () => {
  test("не закрывается, если нажать внутри и отпустить на подложке", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Новый чат" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Новый чат" });
    await expect(dialog).toBeVisible();

    const title = (await dialog.getByRole("heading").boundingBox())!;
    await page.mouse.move(title.x + 5, title.y + 5);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();

    // А обычный клик по подложке — закрывает.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test("Tab не выводит фокус на страницу под окном, Escape закрывает и возвращает фокус", async ({ page }) => {
    await openApp(page);
    const opener = page.getByRole("button", { name: "Новый чат" }).first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Новый чат" });
    await expect(dialog).toBeVisible();

    // Нативный модальный <dialog> ходит по кругу внутри окна с одной
    // остановкой в интерфейсе браузера (адресная строка — в DOM это <body>).
    // Главное — фокус ни разу не попадает на элементы страницы под окном.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "browser-ui";
        return el.closest("dialog") ? "dialog" : `page: ${el.tagName} ${el.getAttribute("aria-label") ?? ""}`;
      });
      expect(where, `Tab №${i + 1}`).not.toMatch(/^page/);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test("переключение с чата на чат не копит историю: «Назад» ведёт к списку", async ({ page }) => {
  await openApp(page);
  await openChat(page, /Анна Смирнова/);
  await page.getByRole("button", { name: /Команда/ }).click();
  await expect(page).toHaveURL(/\/c\/c-group$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Выберите чат")).toBeVisible();
});
