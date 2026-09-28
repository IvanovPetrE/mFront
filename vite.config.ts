import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Дев-прокси нужен, чтобы браузер видел фронт и бэк как один origin —
// иначе refresh-cookie (SameSite=Strict) до бэкенда не долетит.
export default defineConfig({
  plugins: [react()],
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
});
