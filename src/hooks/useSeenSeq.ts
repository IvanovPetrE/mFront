import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Сообщение «увидено», если в прокручиваемой ленте видна хотя бы половина
 * его строки — или, для очень длинных, оно занимает хотя бы половину высоты
 * ленты (иначе порог 50 % для них недостижим).
 */
function isSeen(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= 0.5) return true;
  const rootHeight = entry.rootBounds?.height ?? Infinity;
  return entry.intersectionRect.height >= rootHeight / 2;
}

/**
 * Наибольший `seq` сообщения, которое человек действительно видел на экране.
 *
 * Строки ленты помечены `data-seq`. IntersectionObserver следит, какие из
 * них сейчас в зоне видимости `listRef`, а в «увиденное» они попадают,
 * только пока `attentive` (вкладка на экране и окно в фокусе). Когда
 * человек возвращается к окну, засчитывается то, что видно в этот момент.
 *
 * Раньше «прочитано» уходило на всё, что загружено, — даже если человек
 * читал историю выше, а новое сообщение пришло за пределами экрана.
 *
 * `itemsKey` — что угодно, что меняется при появлении новых строк (обычно
 * сам массив сообщений): по нему новые строки ставятся под наблюдение.
 */
export function useSeenSeq(
  listRef: RefObject<HTMLElement | null>,
  attentive: boolean,
  itemsKey: unknown,
): number {
  const [seenSeq, setSeenSeq] = useState(0);
  const onScreen = useRef(new Set<number>());
  const attentiveRef = useRef(attentive);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const commit = useCallback(() => {
    if (!attentiveRef.current) return;
    let max = 0;
    for (const seq of onScreen.current) if (seq > max) max = seq;
    if (max > 0) setSeenSeq((prev) => (max > prev ? max : prev));
  }, []);

  useEffect(() => {
    attentiveRef.current = attentive;
    commit();
  }, [attentive, commit]);

  useEffect(() => {
    const root = listRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const visible = onScreen.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const seq = Number((entry.target as HTMLElement).dataset.seq);
          if (!seq) continue;
          if (isSeen(entry)) visible.add(seq);
          else visible.delete(seq);
        }
        commit();
      },
      { root, threshold: [0, 0.5, 1] },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      visible.clear();
    };
  }, [listRef, commit]);

  useEffect(() => {
    const root = listRef.current;
    const observer = observerRef.current;
    if (!root || !observer) return;
    // Повторный observe() уже наблюдаемого элемента ничего не делает.
    root.querySelectorAll<HTMLElement>("[data-seq]").forEach((el) => observer.observe(el));
  }, [listRef, itemsKey]);

  return seenSeq;
}
