import { apiFetch } from "./http";
import type { User, UserPublic } from "./types";

export const usersApi = {
  me: () => apiFetch<User>("/users/me"),
  list: () => apiFetch<UserPublic[]>("/users/"),
};
