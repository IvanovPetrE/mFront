// Чистые функции над списком сообщений. Никакого React внутри — поэтому
// их легко проверить тестами, а компонент остаётся про отображение.
//
// Инвариант списка: сообщения упорядочены по seq по возрастанию, id уникальны.

import type { DeliveryStatus, MessageOut } from "../api/types";

// message_status по WS может прийти с опозданием и не по порядку —
// Redis pub/sub и реконнект не гарантируют доставку "в очереди". Без
// ранжирования более старое "sent", пришедшее после "read" (например,
// из повторной доставки), могло бы откатить статус назад в UI.
export const STATUS_RANK: Record<DeliveryStatus, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * Добавить или заменить сообщение, сохранив порядок по seq.
 *
 * Одно и то же сообщение может прийти дважды: из ответа на POST и из
 * message.created по WS, или из WS и из перезагрузки страницы после
 * реконнекта. Раньше message.created просто дописывался в конец —
 * получался дубль на экране и два элемента с одинаковым key.
 */
export function upsertMessage(list: MessageOut[], msg: MessageOut): MessageOut[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  const existing = list[idx];
  if (existing) {
    // Статус не откатываем: копия из ответа POST ("sent") могла прийти уже
    // после WS-события "read" про то же сообщение.
    const merged =
      STATUS_RANK[existing.delivery_status] > STATUS_RANK[msg.delivery_status]
        ? { ...msg, delivery_status: existing.delivery_status }
        : msg;
    const next = list.slice();
    next[idx] = merged;
    return next;
  }
  // Обычно новое сообщение — самое свежее, но не всегда: два сообщения,
  // отправленные почти одновременно, могут прийти по WS в обратном порядке.
  let insertAt = list.length;
  while (insertAt > 0 && list[insertAt - 1]!.seq > msg.seq) insertAt--;
  return [...list.slice(0, insertAt), msg, ...list.slice(insertAt)];
}

export function removeMessage(list: MessageOut[], id: string): MessageOut[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : list;
}

/** Обновить статус доставки — только вперёд по шкале sent < delivered < read. */
export function applyStatus(list: MessageOut[], id: string, status: DeliveryStatus): MessageOut[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.id === id && STATUS_RANK[status] > STATUS_RANK[m.delivery_status]) {
      changed = true;
      return { ...m, delivery_status: status };
    }
    return m;
  });
  return changed ? next : list;
}

/** seq самого нового сообщения в списке, 0 — если список пуст. */
export function lastSeq(list: MessageOut[]): number {
  return list.length ? list[list.length - 1]!.seq : 0;
}

/**
 * Влить свежую страницу с сервера (последние N сообщений) в текущий список.
 *
 * `knownSeqAtRequest` — `lastSeq(list)` на момент ОТПРАВКИ запроса. Он
 * отличает два случая, которые раньше были неразличимы: локальное сообщение
 * новее страницы либо пришло по WS, пока запрос был в пути (оставляем), либо
 * было известно ещё до запроса — тогда сервер обязан был вернуть его в
 * странице «последних N», и раз его нет, его удалили (убираем).
 *
 * В диапазоне seq, который покрывает страница, правда — за сервером: так
 * подхватываются правки и удаления, пропущенные, пока WS был разорван.
 * Сообщения старше страницы оставляем — это задел под пагинацию вверх.
 *
 * Пустая страница значит «в чате сейчас нет сообщений» — оставляем только
 * пришедшие по WS за время запроса. Раньше здесь возвращался `[]`, и такое
 * сообщение пропадало.
 */
export function mergeLatestPage(
  list: MessageOut[],
  page: MessageOut[],
  knownSeqAtRequest: number,
): MessageOut[] {
  const arrivedDuringRequest = (m: MessageOut) => m.seq > knownSeqAtRequest;
  if (page.length === 0) return list.filter(arrivedDuringRequest);
  const known = new Map(list.map((m) => [m.id, m]));
  const sorted = page
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      // Та же защита статуса, что и в upsertMessage: страница могла быть
      // собрана на сервере до того, как по WS пришло "read".
      const local = known.get(m.id);
      return local && STATUS_RANK[local.delivery_status] > STATUS_RANK[m.delivery_status]
        ? { ...m, delivery_status: local.delivery_status }
        : m;
    });
  const minSeq = sorted[0]!.seq;
  const maxSeq = sorted[sorted.length - 1]!.seq;
  const older = list.filter((m) => m.seq < minSeq);
  const newer = list.filter((m) => m.seq > maxSeq && arrivedDuringRequest(m));
  let result = [...older, ...sorted];
  for (const m of newer) result = upsertMessage(result, m);
  return result;
}

/**
 * Какие входящие сообщения отметить прочитанными, если человек увидел ленту
 * до `seenSeq` включительно: по одному на автора — его самое новое из
 * увиденных, если оно ещё не прочитано.
 *
 * Отмечать каждое сообщение не нужно: прочтение монотонно — кто увидел
 * сообщение, видел и все предыдущие от того же автора. Отправитель у себя
 * распространяет статус назад (`displayStatuses`). Раньше открытие чата с N
 * непрочитанными давало N параллельных POST /status.
 */
export function messagesToMarkRead(
  list: MessageOut[],
  seenSeq: number,
  currentUserId: string,
): MessageOut[] {
  const latestByAuthor = new Map<string, MessageOut>();
  for (const m of list) {
    if (m.seq > seenSeq) break; // список упорядочен по seq
    if (m.kind === "system" || m.user_id === null || m.user_id === currentUserId) continue;
    latestByAuthor.set(m.user_id, m); // позднее перезапишет раннее
  }
  return Array.from(latestByAuthor.values()).filter((m) => m.delivery_status !== "read");
}

/**
 * Статус своих сообщений для показа: не ниже, чем у любого СЛЕДУЮЩЕГО своего
 * сообщения. Если прочитано последнее — прочитаны и предыдущие, даже если
 * сервер хранит у них «доставлено» (получатель отмечает только самое новое,
 * см. `messagesToMarkRead`). Чужие сообщения в результат не попадают.
 */
export function displayStatuses(
  list: MessageOut[],
  currentUserId: string,
): Map<string, DeliveryStatus> {
  const result = new Map<string, DeliveryStatus>();
  let best: DeliveryStatus = "sent";
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!;
    if (m.user_id !== currentUserId || m.kind === "system") continue;
    if (STATUS_RANK[m.delivery_status] > STATUS_RANK[best]) best = m.delivery_status;
    result.set(m.id, best);
  }
  return result;
}
