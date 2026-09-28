// Поддельный бэкенд для e2e: REST через page.route, WebSocket через
// page.routeWebSocket. Настоящий бэкенд, Keycloak и Redis не нужны —
// тест проверяет поведение фронта: какие запросы он шлёт и что рисует.

import type { Page, WebSocketRoute } from "@playwright/test";
import type { ChatListItem, ChatMemberOut, MessageOut, UserPublic } from "../src/api/types";

export const ME = {
  id: "u-me",
  external_id: "kc-me",
  email: "me@example.com",
  display_name: "Пётр Иванов",
  avatar_url: null,
};
export const ANNA: UserPublic = { id: "u-anna", display_name: "Анна Смирнова", avatar_url: null };
export const BORIS: UserPublic = { id: "u-boris", display_name: "Борис Петров", avatar_url: null };

const BASE_TIME = Date.now() - 2 * 3600_000;

export function makeMessage(
  chatId: string,
  seq: number,
  userId: string | null,
  status: MessageOut["delivery_status"] = "read",
  content?: string,
): MessageOut {
  return {
    id: `${chatId}-m${seq}`,
    chat_id: chatId,
    user_id: userId,
    seq,
    kind: "text",
    content: content ?? `Сообщение №${seq}. Немного текста, чтобы лента была длинной и прокручивалась.`,
    client_id: null,
    reply_to_id: null,
    delivery_status: status,
    created_at: new Date(BASE_TIME + seq * 30_000).toISOString(),
    edited_at: null,
  };
}

/**
 * Стандартный набор: личный чат с Анной (60 сообщений, из них 20 последних —
 * её непрочитанные) и группа «Команда» из 5 сообщений.
 */
export function defaultData() {
  const direct: MessageOut[] = [];
  for (let s = 1; s <= 60; s++) {
    if (s <= 40) direct.push(makeMessage("c-direct", s, s % 2 ? ANNA.id : ME.id, "read"));
    else direct.push(makeMessage("c-direct", s, ANNA.id, "delivered"));
  }
  const group = [1, 2, 3, 4, 5].map((s) => makeMessage("c-group", s, s % 2 ? BORIS.id : ANNA.id));
  const chats: ChatListItem[] = [
    {
      id: "c-direct",
      type: "direct",
      name: null,
      created_at: new Date(BASE_TIME).toISOString(),
      last_message_at: direct.at(-1)!.created_at,
      unread_count: 20,
      last_message: direct.at(-1)!,
    },
    {
      id: "c-group",
      type: "group",
      name: "Команда",
      created_at: new Date(BASE_TIME).toISOString(),
      last_message_at: group.at(-1)!.created_at,
      unread_count: 0,
      last_message: group.at(-1)!,
    },
  ];
  const members: Record<string, ChatMemberOut[]> = {
    "c-direct": [ME.id, ANNA.id].map((user_id) => ({
      user_id,
      role: "member" as const,
      joined_at: new Date(BASE_TIME).toISOString(),
      left_at: null,
      last_read_seq: 0,
      last_read_at: null,
    })),
  };
  return { chats, messages: { "c-direct": direct, "c-group": group } as Record<string, MessageOut[]>, members };
}

export type MockData = ReturnType<typeof defaultData>;

export interface MockBackend {
  /** Все REST-запросы к API: "POST /messages/x/status?status=read". */
  requests: string[];
  /** Кадры WS: "OPEN /ws/me", "C→S /ws/chat/c1 {...}", "CLOSE /ws/chat/c1". */
  wsLog: string[];
  /** Сокет по пути (последний открытый). */
  socket(path: string): WebSocketRoute;
  /** Отправить клиенту событие от «сервера». */
  push(path: string, event: unknown): void;
  /** Ответ на следующий POST /messages/ (например, ошибка сети). */
  failNextSend(kind: "network" | 500): void;
  /** Все POST /messages/ с телом — для проверки client_id. */
  sent: Array<{ chat_id: string; content: string; client_id: string }>;
}

export async function mockBackend(page: Page, data: MockData = defaultData()): Promise<MockBackend> {
  const requests: string[] = [];
  const wsLog: string[] = [];
  const sockets = new Map<string, WebSocketRoute>();
  const sent: MockBackend["sent"] = [];
  let failNext: "network" | 500 | null = null;
  let nextSeq = 10_000;

  await page.route(/\/(auth|users|chats|messages)\//, async (route) => {
    const req = route.request();
    // Навигация на /chats/<id> — это страница приложения, а не API.
    if (req.resourceType() === "document") return route.continue();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    requests.push(`${method} ${path}${url.search}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/config") {
      return json({
        flow: "bff",
        login_url: "/auth/login",
        csrf_cookie: "mg_csrf",
        csrf_header: "X-CSRF-Token",
        auth_disabled: false,
        password_grant_enabled: false,
        issuer: "test",
        client_id: "test",
      });
    }
    if (path === "/auth/refresh") return json({ access_token: "token", expires_in: 300, token_type: "bearer" });
    if (path === "/auth/logout") return json({ end_session_url: null });
    if (path === "/users/me") return json(ME);
    if (path === "/users/") return json([{ id: ME.id, display_name: ME.display_name, avatar_url: null }, ANNA, BORIS]);
    if (path === "/chats/" && method === "GET") return json(data.chats);
    const members = path.match(/^\/chats\/([^/]+)\/members$/);
    if (members) return json(data.members[members[1]!] ?? []);
    if (/^\/chats\/[^/]+\/read$/.test(path)) return json({});
    if (path === "/messages/" && method === "POST") {
      const body = req.postDataJSON() as { chat_id: string; content: string; client_id: string };
      sent.push(body);
      if (failNext === "network") {
        failNext = null;
        return route.abort("internetdisconnected");
      }
      if (failNext === 500) {
        failNext = null;
        return json({ detail: "boom" }, 500);
      }
      const msg = { ...makeMessage(body.chat_id, ++nextSeq, ME.id, "sent", body.content), client_id: body.client_id };
      return json(msg, 201);
    }
    if (/^\/messages\/[^/]+\/status$/.test(path)) return json({ message_id: path.split("/")[2], status: "read" });
    const list = path.match(/^\/messages\/([^/]+)$/);
    if (list && method === "GET") {
      return json({ items: data.messages[list[1]!] ?? [], next_before_seq: null, has_more: false });
    }
    return json({ detail: "not mocked" }, 404);
  });

  await page.routeWebSocket(/\/ws\//, (ws) => {
    const path = new URL(ws.url()).pathname;
    sockets.set(path, ws);
    wsLog.push(`OPEN ${path}`);
    ws.onMessage((raw) => {
      const text = String(raw);
      wsLog.push(`C→S ${path} ${text}`);
      try {
        if ((JSON.parse(text) as { event?: string }).event === "ping") ws.send(JSON.stringify({ event: "pong" }));
      } catch {
        // не JSON — просто логируем
      }
    });
    ws.onClose(() => wsLog.push(`CLOSE ${path}`));
  });

  return {
    requests,
    wsLog,
    sent,
    socket(path) {
      const ws = sockets.get(path);
      if (!ws) throw new Error(`сокет ${path} не открыт`);
      return ws;
    },
    push(path, event) {
      this.socket(path).send(JSON.stringify(event));
    },
    failNextSend(kind) {
      failNext = kind;
    },
  };
}

/** Сколько запросов с таким префиксом, например "POST /chats/". */
export function count(requests: string[], predicate: (r: string) => boolean): number {
  return requests.filter(predicate).length;
}
