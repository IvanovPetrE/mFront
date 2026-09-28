import { apiFetch } from "./http";
import type { DeliveryStatus, MessageKind, MessageOut, MessagePage } from "./types";

export const messagesApi = {
  list: (chatId: string, opts: { limit?: number; beforeSeq?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.beforeSeq !== undefined) params.set("before_seq", String(opts.beforeSeq));
    const qs = params.toString();
    return apiFetch<MessagePage>(`/messages/${chatId}${qs ? `?${qs}` : ""}`);
  },

  send: (payload: {
    chat_id: string;
    content: string;
    kind?: MessageKind;
    client_id: string;
    reply_to_id?: string | null;
  }) =>
    apiFetch<MessageOut>("/messages/", {
      method: "POST",
      body: JSON.stringify({ kind: "text", ...payload }),
    }),

  edit: (messageId: string, content: string) =>
    apiFetch<MessageOut>(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  remove: (messageId: string) =>
    apiFetch<void>(`/messages/${messageId}`, { method: "DELETE" }),

  // Живой обработчик в messages.py принимает `status: DeliveryStatus` без
  // Pydantic-обёртки — FastAPI трактует такой параметр как query, не body.
  // Только получатель может звать этот метод (не автор сообщения) — иначе
  // бэкенд ответит 403 "Cannot update status of your own message".
  setStatus: (messageId: string, status: DeliveryStatus) =>
    apiFetch<{ message_id: string; status: DeliveryStatus }>(
      `/messages/${messageId}/status?status=${status}`,
      { method: "POST" },
    ),
};
