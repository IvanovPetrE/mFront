import { apiFetch } from "./http";
import type { ChatListItem, ChatMemberOut, ChatOut, ChatType, MemberRole } from "./types";

export const chatsApi = {
  list: () => apiFetch<ChatListItem[]>("/chats/"),

  create: (payload: { type: ChatType; name?: string; member_ids: string[] }) =>
    apiFetch<ChatOut>("/chats/", { method: "POST", body: JSON.stringify(payload) }),

  members: (chatId: string) => apiFetch<ChatMemberOut[]>(`/chats/${chatId}/members`),

  addMember: (chatId: string, userId: string, role: MemberRole = "member") =>
    apiFetch<ChatMemberOut>(`/chats/${chatId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role }),
    }),

  leave: (chatId: string) => apiFetch<ChatMemberOut>(`/chats/${chatId}/members/me`, { method: "DELETE" }),

  markRead: (chatId: string, seq?: number) =>
    apiFetch<ChatMemberOut>(`/chats/${chatId}/read`, {
      method: "POST",
      body: seq !== undefined ? JSON.stringify({ seq }) : undefined,
    }),
};
