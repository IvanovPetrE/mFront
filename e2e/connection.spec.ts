import { expect, test } from "@playwright/test";
import { count, mockBackend } from "./mockBackend";

// Телефон вышел из сна, сокет формально открыт, но сервер уже не отвечает.
// Раньше это замечалось только через 60–85 с (проверка по времени молчания),
// а в фоне Chrome сдвигал таймеры и давал ложные разрывы. Теперь при
// возврате на вкладку уходит внеочередной ping, и без ответа за 5 с клиент
// бросает соединение и переподключается.
test("мёртвое соединение обнаруживается при возврате на вкладку", async ({ page }) => {
  await page.clock.install();
  const backend = await mockBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Анна Смирнова/ }).click();
  await expect(page.locator(".msg-row").first()).toBeVisible();

  const path = "/ws/chat/c-direct";
  // Плановый ping через 25 с: сервер отвечает, значит, ping он поддерживает.
  await page.clock.fastForward(26_000);
  await expect.poll(() => backend.wsLog.filter((l) => l.startsWith(`C→S ${path}`) && l.includes("ping")).length).toBe(1);

  // В dev StrictMode открывает лишний сокет и дважды грузит ленту — считаем от текущих значений.
  const loads = () => count(backend.requests, (r) => r.startsWith("GET /messages/c-direct"));
  const opensBefore = backend.opens(path);
  const loadsBefore = loads();

  backend.mute(path);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.clock.fastForward(5_100); // ответа на проверку нет
  await page.clock.fastForward(1_500); // пауза перед переподключением (0,5–1 с)

  await expect.poll(() => backend.opens(path)).toBe(opensBefore + 1);
  // После переподключения лента перезапрашивается: события за время разрыва потеряны.
  await expect.poll(loads).toBe(loadsBefore + 1);
});
