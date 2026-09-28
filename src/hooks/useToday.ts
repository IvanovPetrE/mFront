import { useEffect, useState } from "react";
import { startOfDay } from "../utils/dates";

/**
 * Начало сегодняшнего дня (мс), которое само обновляется в полночь.
 *
 * Подписи «Сегодня» / «Вчера» и время в списке чатов считаются относительно
 * текущей даты. Без этого хука вкладка, оставленная открытой на ночь,
 * до следующего события показывала бы вчерашнее как «Сегодня».
 * Передавайте значение в компоненты явно (пропсом или в зависимости
 * useMemo), чтобы мемоизация не спрятала смену дня.
 */
export function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // +1 с запасом: таймер может сработать на пару миллисекунд раньше.
    const t = setTimeout(() => setToday(startOfDay(new Date())), nextMidnight.getTime() - now.getTime() + 1000);
    return () => clearTimeout(t);
  }, [today]);
  return today;
}
