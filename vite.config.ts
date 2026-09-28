/// <reference types="vitest/config" />
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Дев-прокси нужен, чтобы браузер видел фронт и бэк как один origin —
// иначе refresh-cookie (SameSite=Strict) до бэкенда не долетит.
// Адрес открытого чата — /c/<id>, а не /chats/<id>: /chats проксируется на API.
export default defineConfig({
  plugins: [
    react(),
    // React Compiler: сам мемоизирует компоненты и значения, ручные
    // useMemo/useCallback/memo становятся не нужны. Компоненты, нарушающие
    // правила React (например, запись в ref во время рендера), он пропускает —
    // это же подсвечивает eslint-plugin-react-hooks.
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:8000",
      "/chats": "http://localhost:8000",
      "/messages": "http://localhost:8000",
      "/users": "http://localhost:8000",
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  test: {
    // Только юнит-тесты; e2e/*.spec.ts запускает Playwright.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
