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
  if (idx !== -1) {
    const existing = list[idx];
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
  while (insertAt > 0 && list[insertAt - 1].seq > msg.seq) insertAt--;
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

/**
 * Влить свежую страницу с сервера (последние N сообщений) в текущий список.
 *
 * В диапазоне seq, который покрывает страница, правда — за сервером: так
 * подхватываются правки и удаления, пропущенные, пока WS был разорван.
 * Сообщения новее страницы оставляем: они могли прийти по WS, пока
 * запрос был в пути. Раньше список заменялся страницей целиком, и такое
 * сообщение молча пропадало с экрана до следующей перезагрузки.
 * Сообщения старше страницы тоже оставляем — это задел под пагинацию вверх.
 *
 * Известный предел (следствие того, что у бэкенда нет `after_seq`, только
 * `before_seq` — см. ревью бэкенда, P1-1): если удалили именно САМОЕ
 * новое сообщение в чате, страница вернёт maxSeq меньше, чем seq
 * удалённого. Отличить это от «пришло новое сообщение по WS, пока страница
 * была в пути» нечем — оба выглядят как «локально есть seq больше
 * maxSeq страницы». Пока предпочитаем не терять данные: считаем такое
 * сообщение новым и оставляем. Если это было именно удаление последнего
 * сообщения, оно провиснет в UI до следующего успешного message.deleted
 * или полной перезагрузки страницы браузера. Правильное решение — на
 * стороне бэкенда.
 */
export function mergeLatestPage(list: MessageOut[], page: MessageOut[]): MessageOut[] {
  if (page.length === 0) return [];
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
  const minSeq = sorted[0].seq;
  const maxSeq = sorted[sorted.length - 1].seq;
  const older = list.filter((m) => m.seq < minSeq);
  const newer = list.filter((m) => m.seq > maxSeq);
  let result = [...older, ...sorted];
  for (const m of newer) result = upsertMessage(result, m);
  return result;
}
