// Телефон: одна колонка — либо список чатов, либо открытый чат.
import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";

test("системная «Назад» из чата возвращает к списку, а не уводит из мессенджера", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Команда/ }).click();
  await expect(page).toHaveURL(/\/c\/c-group$/);
  await expect(page.getByRole("heading", { name: "Команда" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /Анна Смирнова/ })).toBeVisible();
  await expect(page.locator(".chat-window")).toHaveCount(0);
});

test("перезагрузка на /c/<id> открывает тот же чат; «Назад» в шапке ведёт к списку", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/c/c-group");
  await expect(page.getByRole("heading", { name: "Команда" })).toBeVisible();

  await page.getByRole("button", { name: "Назад к списку чатов" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /Анна Смирнова/ })).toBeVisible();
});

test("«Назад» в шапке и повторное открытие не копят записи истории", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Команда/ }).click();
  await page.getByRole("button", { name: "Назад к списку чатов" }).click();
  await page.getByRole("button", { name: /Анна Смирнова/ }).click();
  await expect(page).toHaveURL(/\/c\/c-direct$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".chat-window")).toHaveCount(0);
});
