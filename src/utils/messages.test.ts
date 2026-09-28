import { describe, expect, it } from "vitest";
import type { DeliveryStatus, MessageOut } from "../api/types";
import {
  applyStatus,
  displayStatuses,
  lastSeq,
  mergeLatestPage,
  messagesToMarkRead,
  removeMessage,
  upsertMessage,
} from "./messages";

const ME = "me";
const ANNA = "anna";
const BORIS = "boris";

function msg(seq: number, user: string | null = ANNA, status: DeliveryStatus = "sent", extra: Partial<MessageOut> = {}): MessageOut {
  return {
    id: `m${seq}`,
    chat_id: "c",
    user_id: user,
    seq,
    kind: user === null ? "system" : "text",
    content: `#${seq}`,
    client_id: null,
    reply_to_id: null,
    delivery_status: status,
    created_at: new Date(Date.UTC(2026, 8, 28, 8, seq)).toISOString(),
    edited_at: null,
    ...extra,
  };
}
const seqs = (list: MessageOut[]) => list.map((m) => m.seq);

describe("upsertMessage", () => {
  it("добавляет в конец новое сообщение", () => {
    expect(seqs(upsertMessage([msg(1), msg(2)], msg(3)))).toEqual([1, 2, 3]);
  });

  it("сообщение, пришедшее не по порядку, встаёт на своё место по seq", () => {
    expect(seqs(upsertMessage([msg(1), msg(3)], msg(2)))).toEqual([1, 2, 3]);
  });

  it("дубль по id заменяет, а не добавляет", () => {
    const edited = msg(2, ANNA, "sent", { content: "правка" });
    const result = upsertMessage([msg(1), msg(2)], edited);
    expect(result).toHaveLength(2);
    expect(result[1]!.content).toBe("правка");
  });

  it("статус не откатывается назад, если копия со старым статусом пришла позже", () => {
    const result = upsertMessage([msg(1, ME, "read")], msg(1, ME, "sent"));
    expect(result[0]!.delivery_status).toBe("read");
  });
});

describe("removeMessage / applyStatus", () => {
  it("removeMessage возвращает тот же массив, если удалять нечего", () => {
    const list = [msg(1)];
    expect(removeMessage(list, "nope")).toBe(list);
    expect(seqs(removeMessage([msg(1), msg(2)], "m1"))).toEqual([2]);
  });

  it("applyStatus меняет статус только вперёд и не пересоздаёт массив зря", () => {
    const list = [msg(1, ME, "delivered")];
    expect(applyStatus(list, "m1", "sent")).toBe(list);
    expect(applyStatus(list, "m1", "read")[0]!.delivery_status).toBe("read");
  });
});

describe("mergeLatestPage", () => {
  it("в диапазоне страницы правда за сервером: правки и удаления подхватываются", () => {
    const local = [msg(1), msg(2), msg(3)];
    const page = [msg(1), msg(3, ANNA, "sent", { content: "правка" })]; // m2 удалено
    const result = mergeLatestPage(local, page, lastSeq(local));
    expect(seqs(result)).toEqual([1, 3]);
    expect(result[1]!.content).toBe("правка");
  });

  it("сообщение, пришедшее по WS за время запроса, не теряется", () => {
    const known = lastSeq([msg(1), msg(2)]); // 2 — на момент отправки запроса
    const local = [msg(1), msg(2), msg(3)]; // m3 пришло по WS, пока запрос летел
    expect(seqs(mergeLatestPage(local, [msg(1), msg(2)], known))).toEqual([1, 2, 3]);
  });

  it("удалённое САМОЕ новое сообщение убирается (было известно до запроса)", () => {
    const local = [msg(1), msg(2), msg(3)];
    expect(seqs(mergeLatestPage(local, [msg(1), msg(2)], lastSeq(local)))).toEqual([1, 2]);
  });

  it("пустая страница оставляет только пришедшее за время запроса", () => {
    // Регресс из ревью: раньше пустая страница возвращала [] и теряла m1.
    expect(seqs(mergeLatestPage([msg(1)], [], 0))).toEqual([1]);
    // А известные до запроса — удалены на сервере.
    expect(seqs(mergeLatestPage([msg(1)], [], 1))).toEqual([]);
  });

  it("сообщения старше страницы остаются (задел под пагинацию)", () => {
    const local = [msg(1), msg(2), msg(3)];
    expect(seqs(mergeLatestPage(local, [msg(3)], 3))).toEqual([1, 2, 3]);
  });

  it("статус из страницы не откатывает более свежий локальный", () => {
    const local = [msg(1, ME, "read")];
    expect(mergeLatestPage(local, [msg(1, ME, "delivered")], 1)[0]!.delivery_status).toBe("read");
  });
});

describe("messagesToMarkRead", () => {
  it("по одному сообщению на автора — самому новому из увиденных", () => {
    const list = [msg(1, ANNA), msg(2, BORIS), msg(3, ANNA), msg(4, ME), msg(5, BORIS), msg(6, ANNA)];
    expect(seqs(messagesToMarkRead(list, 5, ME))).toEqual([3, 5]);
  });

  it("ничего, если самое новое увиденное от автора уже прочитано", () => {
    // m1 не прочитано на сервере, но m2 от того же автора прочитано — значит, и m1 тоже.
    const list = [msg(1, ANNA, "delivered"), msg(2, ANNA, "read")];
    expect(messagesToMarkRead(list, 2, ME)).toEqual([]);
  });

  it("свои и системные сообщения не отмечаются", () => {
    expect(messagesToMarkRead([msg(1, ME), msg(2, null)], 2, ME)).toEqual([]);
  });
});

describe("displayStatuses", () => {
  it("прочитано последнее своё — прочитаны и предыдущие", () => {
    const list = [msg(1, ME, "delivered"), msg(2, ANNA), msg(3, ME, "sent"), msg(4, ME, "read")];
    const s = displayStatuses(list, ME);
    expect([s.get("m1"), s.get("m3"), s.get("m4")]).toEqual(["read", "read", "read"]);
    expect(s.get("m2")).toBeUndefined();
  });

  it("более новое, но ещё не доставленное, не повышает статус старых", () => {
    const s = displayStatuses([msg(1, ME, "delivered"), msg(2, ME, "sent")], ME);
    expect([s.get("m1"), s.get("m2")]).toEqual(["delivered", "sent"]);
  });
});
